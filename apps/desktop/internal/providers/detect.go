package providers

import (
	"os/exec"
	"runtime"
	"strings"
)

type Health struct {
	ID           string         `json:"id"`
	DisplayName  string         `json:"displayName"`
	Available    bool           `json:"available"`
	Path         string         `json:"path,omitempty"`
	Version      string         `json:"version,omitempty"`
	Auth         string         `json:"auth"`
	Detail       string         `json:"detail,omitempty"`
	Capabilities map[string]any `json:"capabilities"`
}

func DetectAll() []Health {
	return []Health{
		detectOne("codex", "Codex CLI", map[string]any{
			"nonInteractive": true, "continueSession": true, "structuredStream": true,
			"applyDiff": true, "policyRules": true,
		}),
		detectOne("claude", "Claude Code", map[string]any{
			"nonInteractive": true, "continueSession": true, "structuredStream": true,
			"applyDiff": false, "policyRules": true,
		}),
		detectOne("grok", "Grok CLI", map[string]any{
			"nonInteractive": true, "continueSession": true, "structuredStream": true,
			"applyDiff": false, "policyRules": true,
		}),
	}
}

func detectOne(id, name string, caps map[string]any) Health {
	h := Health{
		ID: id, DisplayName: name, Auth: "unknown", Capabilities: caps,
	}
	path, err := exec.LookPath(id)
	if err != nil {
		// Windows sometimes needs .exe
		if runtime.GOOS == "windows" {
			path, err = exec.LookPath(id + ".exe")
		}
	}
	if err != nil || path == "" {
		h.Available = false
		h.Detail = "not found on PATH"
		h.Auth = "unknown"
		return h
	}
	h.Available = true
	h.Path = path
	h.Version = firstLine(runVersion(id))
	h.Auth = "unknown"
	if id == "codex" {
		// doctor may be slow; keep light
		h.Auth = "unknown"
	}
	return h
}

func runVersion(id string) string {
	var cmd *exec.Cmd
	switch id {
	case "codex":
		cmd = exec.Command(id, "--version")
	case "claude":
		cmd = exec.Command(id, "--version")
	case "grok":
		cmd = exec.Command(id, "--version")
	default:
		cmd = exec.Command(id, "--version")
	}
	b, err := cmd.CombinedOutput()
	if err != nil {
		// some CLIs print help on unknown flags
		return strings.TrimSpace(string(b))
	}
	return strings.TrimSpace(string(b))
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	if len(s) > 120 {
		return s[:120]
	}
	return s
}

func ResolveBin(id string) (string, error) {
	path, err := exec.LookPath(id)
	if err != nil && runtime.GOOS == "windows" {
		path, err = exec.LookPath(id + ".exe")
	}
	return path, err
}
