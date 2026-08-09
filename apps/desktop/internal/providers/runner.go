package providers

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type Event struct {
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
}

type StartOpts struct {
	ProviderID string
	Workspace  string
	Prompt     string
	Continue   bool
	Note       string
	HumanSummary string
}

// RunAgent launches a local CLI non-interactively and streams normalized-ish events.
func RunAgent(ctx context.Context, opts StartOpts, emit func(Event)) error {
	id := opts.ProviderID
	if id == "" {
		id = "codex"
	}
	bin, err := ResolveBin(id)
	if err != nil {
		emit(Event{Type: "error", Payload: map[string]any{"message": fmt.Sprintf("%s not found: %v", id, err), "retriable": false}})
		return err
	}

	prompt := opts.Prompt
	if opts.Continue {
		prompt = buildContinuePrompt(opts.HumanSummary, opts.Note, opts.Prompt)
	}

	emit(Event{Type: "message.assistant", Payload: map[string]any{
		"text": fmt.Sprintf("使用本地引擎 **%s** 在工作区执行…\n`%s`", id, bin),
	}})
	emit(Event{Type: "plan.updated", Payload: map[string]any{
		"steps": []map[string]any{
			{"id": "1", "title": "启动本地 CLI", "state": "running"},
			{"id": "2", "title": "收集输出", "state": "pending"},
			{"id": "3", "title": "扫描工作区变更", "state": "pending"},
		},
	}})

	args := buildArgs(id, opts.Workspace, prompt, opts.Continue)
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = opts.Workspace
	// Avoid interactive prompts as much as possible
	cmd.Env = append(os.Environ(), "CI=1", "NO_COLOR=1")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	// Also surface as terminal
	cmdLine := bin + " " + strings.Join(args, " ")
	emit(Event{Type: "shell.start", Payload: map[string]any{"command": cmdLine, "cwd": opts.Workspace, "class": "workspace_write"}})

	start := time.Now()
	if err := cmd.Start(); err != nil {
		emit(Event{Type: "error", Payload: map[string]any{"message": err.Error()}})
		return err
	}

	var outBuf strings.Builder
	scan := func(r interface{ Read([]byte) (int, error) }, stream string) {
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
		for sc.Scan() {
			line := sc.Text() + "\n"
			outBuf.WriteString(line)
			emit(Event{Type: "shell.output", Payload: map[string]any{"stream": stream, "text": line}})
		}
	}
	done := make(chan struct{}, 2)
	go func() { scan(stdout, "stdout"); done <- struct{}{} }()
	go func() { scan(stderr, "stderr"); done <- struct{}{} }()
	<-done
	<-done

	waitErr := cmd.Wait()
	code := 0
	if waitErr != nil {
		if ee, ok := waitErr.(*exec.ExitError); ok {
			code = ee.ExitCode()
			waitErr = nil
		}
	}
	emit(Event{Type: "shell.exit", Payload: map[string]any{
		"exitCode": code, "durationMs": time.Since(start).Milliseconds(),
	}})

	// Assistant summary from last stdout chunks
	summary := strings.TrimSpace(outBuf.String())
	if len(summary) > 4000 {
		summary = summary[len(summary)-4000:]
	}
	if summary != "" {
		emit(Event{Type: "message.assistant", Payload: map[string]any{"text": summary}})
	}

	emit(Event{Type: "plan.updated", Payload: map[string]any{
		"steps": []map[string]any{
			{"id": "1", "title": "启动本地 CLI", "state": "done"},
			{"id": "2", "title": "收集输出", "state": "done"},
			{"id": "3", "title": "扫描工作区变更", "state": "running"},
		},
	}})

	// Detect changed files via git
	for _, e := range detectEdits(opts.Workspace) {
		emit(e)
	}

	emit(Event{Type: "plan.updated", Payload: map[string]any{
		"steps": []map[string]any{
			{"id": "1", "title": "启动本地 CLI", "state": "done"},
			{"id": "2", "title": "收集输出", "state": "done"},
			{"id": "3", "title": "扫描工作区变更", "state": "done"},
		},
	}})

	if waitErr != nil {
		emit(Event{Type: "error", Payload: map[string]any{"message": waitErr.Error(), "retriable": true}})
		return waitErr
	}
	if code != 0 {
		emit(Event{Type: "error", Payload: map[string]any{
			"message":  fmt.Sprintf("%s exited with code %d", id, code),
			"retriable": true,
			"code":     fmt.Sprintf("exit_%d", code),
		}})
	}
	return nil
}

func buildArgs(id, workspace, prompt string, cont bool) []string {
	switch id {
	case "codex":
		// non-interactive exec; --cd sets workspace
		args := []string{"exec", "--skip-git-repo-check", "-C", workspace, prompt}
		return args
	case "claude":
		args := []string{"-p", prompt, "--output-format", "text", "--add-dir", workspace}
		if cont {
			args = append([]string{"-c"}, args...)
		}
		return args
	case "grok":
		args := []string{"--cwd", workspace, "--print", prompt}
		if cont {
			args = append([]string{"-c"}, args...)
		}
		// permission-friendly for automation where possible
		if runtime.GOOS != "" {
			args = append([]string{"--always-approve"}, args...)
		}
		return args
	default:
		return []string{prompt}
	}
}

func buildContinuePrompt(humanSummary, note, original string) string {
	var b strings.Builder
	b.WriteString("Continue the previous task. Human edits on disk take precedence over any unapplied agent patches.\n")
	if humanSummary != "" {
		b.WriteString("\n## Human edit summary\n")
		b.WriteString(humanSummary)
		b.WriteString("\n")
	}
	if note != "" {
		b.WriteString("\n## User note\n")
		b.WriteString(note)
		b.WriteString("\n")
	}
	if original != "" {
		b.WriteString("\n## Original request\n")
		b.WriteString(original)
		b.WriteString("\n")
	}
	b.WriteString("\nProceed with the next steps.")
	return b.String()
}

func detectEdits(workspace string) []Event {
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = workspace
	b, err := cmd.Output()
	if err != nil {
		return nil
	}
	var events []Event
	for _, line := range strings.Split(string(b), "\n") {
		if len(line) < 4 {
			continue
		}
		code := strings.TrimSpace(line[:2])
		path := strings.TrimSpace(line[3:])
		if i := strings.Index(path, " -> "); i >= 0 {
			path = path[i+4:]
		}
		path = filepath.ToSlash(path)
		kind := "M"
		if code == "??" || strings.Contains(code, "A") {
			kind = "A"
		} else if strings.Contains(code, "D") {
			kind = "D"
		}
		events = append(events, Event{
			Type: "file.edit_proposed",
			Payload: map[string]any{
				"path": path, "kind": kind,
			},
		})
		if len(events) >= 40 {
			break
		}
	}
	return events
}
