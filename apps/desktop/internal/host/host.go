package host

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/vantiboolean/her-dock/apps/desktop/internal/fsutil"
	"github.com/vantiboolean/her-dock/apps/desktop/internal/policy"
	"github.com/vantiboolean/her-dock/apps/desktop/internal/providers"
	"github.com/vantiboolean/her-dock/apps/desktop/internal/shell"
	"github.com/vantiboolean/her-dock/apps/desktop/internal/store"
)

type Host struct {
	store   *store.Store
	dataDir string
	snapDir string
	policy  policy.Bundle
	mu      sync.Mutex
	// runId -> cancel
	cancels map[string]context.CancelFunc
	// SSE subscribers
	subsMu sync.Mutex
	subs   map[chan map[string]any]struct{}
	// pending approvals
	approvals map[string]chan string
}

func New(dataDir string) (*Host, error) {
	st, err := store.Open(filepath.Join(dataDir, "her-dock.db"))
	if err != nil {
		return nil, err
	}
	snap := filepath.Join(dataDir, "checkpoints")
	_ = os.MkdirAll(snap, 0o755)
	h := &Host{
		store:     st,
		dataDir:   dataDir,
		snapDir:   snap,
		policy:    policy.DemoOrg(),
		cancels:   map[string]context.CancelFunc{},
		subs:      map[chan map[string]any]struct{}{},
		approvals: map[string]chan string{},
	}
	return h, nil
}

func (h *Host) Close() error { return h.store.Close() }

func (h *Host) Policy() policy.Bundle { return h.policy }

func (h *Host) SetPolicy(b policy.Bundle) { h.policy = b }

func (h *Host) Subscribe() chan map[string]any {
	ch := make(chan map[string]any, 64)
	h.subsMu.Lock()
	h.subs[ch] = struct{}{}
	h.subsMu.Unlock()
	return ch
}

func (h *Host) Unsubscribe(ch chan map[string]any) {
	h.subsMu.Lock()
	delete(h.subs, ch)
	h.subsMu.Unlock()
	close(ch)
}

func (h *Host) broadcast(ev map[string]any) {
	h.subsMu.Lock()
	defer h.subsMu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- ev:
		default:
		}
	}
}

func (h *Host) ListProviders() []providers.Health {
	return providers.DetectAll()
}

func (h *Host) ListConnectors() []map[string]any {
	return []map[string]any{
		{"id": "github", "name": "GitHub", "status": "connected", "scopes": []string{"repo", "read:user"}, "hostPatterns": []string{"api.github.com"}},
		{"id": "feishu", "name": "飞书", "status": "expired", "scopes": []string{"im:message"}, "detail": "OAuth token expired"},
		{"id": "warehouse", "name": "销售数仓只读", "status": "disconnected", "scopes": []string{"select"}},
		{"id": "browser", "name": "网页抓取", "status": "connected", "scopes": []string{"fetch"}, "hostPatterns": []string{"*.example.com"}},
	}
}

type OpenWorkspaceReq struct {
	Path string `json:"path"`
}

func (h *Host) OpenWorkspace(path string) (*store.Workspace, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !st.IsDir() {
		return nil, fmt.Errorf("not a directory: %s", abs)
	}
	if existing, _ := h.store.GetWorkspaceByPath(abs); existing != nil {
		existing.Branch = fsutil.GitBranch(abs)
		existing.DirtySummary = fsutil.GitDirtySummary(abs)
		existing.UpdatedAt = store.Now()
		_ = h.store.UpsertWorkspace(*existing)
		return existing, nil
	}
	name := filepath.Base(abs)
	w := store.Workspace{
		ID:           "ws_" + uuid.NewString()[:8],
		Name:         name,
		RootPath:     abs,
		Branch:       fsutil.GitBranch(abs),
		DirtySummary: fsutil.GitDirtySummary(abs),
		CreatedAt:    store.Now(),
		UpdatedAt:    store.Now(),
	}
	if err := h.store.UpsertWorkspace(w); err != nil {
		return nil, err
	}
	return &w, nil
}

func (h *Host) ListWorkspaces() ([]store.Workspace, error) {
	return h.store.ListWorkspaces()
}

func (h *Host) GetTree(workspaceID string, depth int) ([]fsutil.Node, error) {
	w, err := h.store.GetWorkspace(workspaceID)
	if err != nil || w == nil {
		return nil, fmt.Errorf("workspace not found")
	}
	return fsutil.Tree(w.RootPath, depth)
}

func (h *Host) ReadFile(workspaceID, rel string) (string, error) {
	w, err := h.store.GetWorkspace(workspaceID)
	if err != nil || w == nil {
		return "", fmt.Errorf("workspace not found")
	}
	if !policy.EvaluateRead(h.policy, rel) {
		return "", fmt.Errorf("read denied by org policy: %s", rel)
	}
	return fsutil.ReadFile(w.RootPath, rel)
}

func (h *Host) WriteFile(workspaceID, rel, content string) error {
	w, err := h.store.GetWorkspace(workspaceID)
	if err != nil || w == nil {
		return fmt.Errorf("workspace not found")
	}
	if !policy.EvaluateWrite(h.policy, rel) {
		return fmt.Errorf("write denied by org policy: %s", rel)
	}
	// checkpoint before write
	cpID := "cp_" + uuid.NewString()[:8]
	destDir := filepath.Join(h.snapDir, cpID)
	_, _ = fsutil.SnapshotFile(w.RootPath, rel, destDir)
	_ = h.store.InsertCheckpoint(cpID, "manual", "before write "+rel, destDir, store.Now())
	return fsutil.WriteFile(w.RootPath, rel, content)
}

func (h *Host) ListSessions(workspaceID string) ([]store.Session, error) {
	return h.store.ListSessions(workspaceID)
}

func (h *Host) ListRuns(sessionID string) ([]store.Run, error) {
	return h.store.ListRuns(sessionID)
}

func (h *Host) ListRecentRuns(limit int) ([]store.Run, error) {
	return h.store.ListRecentRuns(limit)
}

func (h *Host) ListEvents(runID string) ([]map[string]any, error) {
	return h.store.ListEvents(runID)
}

func (h *Host) ListCheckpoints(runID string) ([]map[string]any, error) {
	return h.store.ListCheckpoints(runID)
}

func (h *Host) ListArtifacts(workspaceID string) ([]map[string]any, error) {
	return h.store.ListArtifacts(workspaceID)
}

type CreateSessionReq struct {
	WorkspaceID string `json:"workspaceId"`
	Title       string `json:"title"`
	Kind        string `json:"kind"`
	ProviderID  string `json:"providerId"`
}

func (h *Host) CreateSession(req CreateSessionReq) (*store.Session, error) {
	if req.Kind == "" {
		req.Kind = "mixed"
	}
	if req.ProviderID == "" {
		req.ProviderID = "codex"
	}
	if req.Title == "" {
		req.Title = "新会话"
	}
	sess := store.Session{
		ID:          "sess_" + uuid.NewString()[:8],
		WorkspaceID: req.WorkspaceID,
		Title:       req.Title,
		Kind:        req.Kind,
		ProviderID:  req.ProviderID,
		CreatedAt:   store.Now(),
		UpdatedAt:   store.Now(),
	}
	if err := h.store.InsertSession(sess); err != nil {
		return nil, err
	}
	return &sess, nil
}

type StartRunReq struct {
	SessionID   string `json:"sessionId"`
	WorkspaceID string `json:"workspaceId"`
	ProviderID  string `json:"providerId"`
	Prompt      string `json:"prompt"`
	AutoExecute string `json:"autoExecute"`
	// Demo mode skips real CLI and emits fixture-like stream (useful without API keys).
	Demo bool `json:"demo"`
}

type ContinueRunReq struct {
	RunID          string `json:"runId"`
	HumanSummary   string `json:"humanSummary"`
	Note           string `json:"note"`
	AutoExecute    string `json:"autoExecute"`
	Demo           bool   `json:"demo"`
}

func (h *Host) StartRun(req StartRunReq) (*store.Run, error) {
	sess, err := h.store.GetSession(req.SessionID)
	if err != nil || sess == nil {
		return nil, fmt.Errorf("session not found")
	}
	w, err := h.store.GetWorkspace(req.WorkspaceID)
	if err != nil || w == nil {
		return nil, fmt.Errorf("workspace not found")
	}
	provider := req.ProviderID
	if provider == "" {
		provider = sess.ProviderID
	}
	auto := policy.ClampAuto(req.AutoExecute, h.policy.MaxAutoExecute)
	if auto == "" {
		auto = h.policy.MaxAutoExecute
	}

	run := store.Run{
		ID:          "RUN-" + strings.ToUpper(uuid.NewString()[:6]),
		SessionID:   sess.ID,
		WorkspaceID: w.ID,
		ProviderID:  provider,
		Status:      "starting",
		Prompt:      req.Prompt,
		CreatedAt:   store.Now(),
		UpdatedAt:   store.Now(),
		StartedAt:   store.Now(),
	}
	if err := h.store.InsertRun(run); err != nil {
		return nil, err
	}
	_ = h.store.TouchSession(sess.ID)

	ctx, cancel := context.WithCancel(context.Background())
	h.mu.Lock()
	h.cancels[run.ID] = cancel
	h.mu.Unlock()

	go h.executeRun(ctx, run, w.RootPath, auto, req.Demo, false, "", "")
	return &run, nil
}

func (h *Host) ContinueRun(req ContinueRunReq) (*store.Run, error) {
	prev, err := h.store.GetRun(req.RunID)
	if err != nil || prev == nil {
		return nil, fmt.Errorf("run not found")
	}
	w, err := h.store.GetWorkspace(prev.WorkspaceID)
	if err != nil || w == nil {
		return nil, fmt.Errorf("workspace not found")
	}
	auto := policy.ClampAuto(req.AutoExecute, h.policy.MaxAutoExecute)
	if auto == "" {
		auto = h.policy.MaxAutoExecute
	}

	run := store.Run{
		ID:          "RUN-" + strings.ToUpper(uuid.NewString()[:6]),
		SessionID:   prev.SessionID,
		WorkspaceID: prev.WorkspaceID,
		ProviderID:  prev.ProviderID,
		Status:      "starting",
		Prompt:      prev.Prompt,
		CreatedAt:   store.Now(),
		UpdatedAt:   store.Now(),
		StartedAt:   store.Now(),
	}
	if err := h.store.InsertRun(run); err != nil {
		return nil, err
	}
	_ = h.store.TouchSession(prev.SessionID)

	ctx, cancel := context.WithCancel(context.Background())
	h.mu.Lock()
	h.cancels[run.ID] = cancel
	h.mu.Unlock()

	go h.executeRun(ctx, run, w.RootPath, auto, req.Demo, true, req.HumanSummary, req.Note)
	return &run, nil
}

func (h *Host) CancelRun(runID string) error {
	h.mu.Lock()
	cancel, ok := h.cancels[runID]
	h.mu.Unlock()
	if ok {
		cancel()
	}
	_ = h.store.UpdateRunStatus(runID, "cancelled", "cancelled by user", "")
	h.emitRaw(runID, "run.status", map[string]any{"status": "cancelled"})
	return nil
}

func (h *Host) ResolveApproval(approvalID, decision string) error {
	h.mu.Lock()
	ch, ok := h.approvals[approvalID]
	h.mu.Unlock()
	if !ok {
		return fmt.Errorf("approval not found")
	}
	if decision == "always_allow" {
		// scope embedded in id: approvalId may include scope after |
	}
	select {
	case ch <- decision:
	default:
	}
	return nil
}

func (h *Host) RunShell(workspaceID, command string) (map[string]any, error) {
	w, err := h.store.GetWorkspace(workspaceID)
	if err != nil || w == nil {
		return nil, fmt.Errorf("workspace not found")
	}
	class, need := policy.RequiresApproval(h.policy, command, h.policy.MaxAutoExecute)
	if need {
		return nil, fmt.Errorf("shell requires approval (%s): %s", class, command)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	var lines []string
	res, err := shell.Run(ctx, w.RootPath, command, func(o shell.Output) {
		lines = append(lines, o.Text)
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"exitCode": res.ExitCode, "durationMs": res.DurationMs, "output": strings.Join(lines, ""),
	}, nil
}

func (h *Host) executeRun(ctx context.Context, run store.Run, root, auto string, demo, cont bool, humanSummary, note string) {
	defer func() {
		h.mu.Lock()
		delete(h.cancels, run.ID)
		h.mu.Unlock()
	}()

	_ = h.store.UpdateRunStatus(run.ID, "running", "", "0/3")
	h.emitRaw(run.ID, "run.status", map[string]any{"status": "running"})
	h.emitRaw(run.ID, "message.user", map[string]any{"text": run.Prompt})

	// checkpoint at start
	cpID := "cp_" + uuid.NewString()[:8]
	cpDir := filepath.Join(h.snapDir, cpID)
	_ = os.MkdirAll(cpDir, 0o755)
	_ = h.store.InsertCheckpoint(cpID, run.ID, "会话/运行开始", cpDir, store.Now())
	h.emitRaw(run.ID, "checkpoint.created", map[string]any{
		"checkpointId": cpID, "label": "会话/运行开始", "snapshotRef": cpDir,
	})

	emit := func(e providers.Event) {
		h.emitProvider(run.ID, e)
	}

	var runErr error
	if demo {
		runErr = h.runDemo(ctx, run, root, emit)
	} else {
		// optional approval for agent launch under strict auto
		class, need := policy.RequiresApproval(h.policy, run.ProviderID+" agent", auto)
		if need && class == "unknown" {
			// treat agent launch as workspace_write equivalent — only block if ask_always
			if auto == "ask_always" {
				dec, err := h.requestApproval(run.ID, "启动本地 Agent", "Provider: "+run.ProviderID, "medium", "shell", "shell:workspace_write")
				if err != nil || dec == "deny" {
					_ = h.store.UpdateRunStatus(run.ID, "cancelled", "denied", "")
					h.emitRaw(run.ID, "run.status", map[string]any{"status": "cancelled"})
					return
				}
			}
		}
		runErr = providers.RunAgent(ctx, providers.StartOpts{
			ProviderID:   run.ProviderID,
			Workspace:    root,
			Prompt:       run.Prompt,
			Continue:     cont,
			Note:         note,
			HumanSummary: humanSummary,
		}, emit)
	}

	// scan out/ for artifacts
	h.scanArtifacts(run, root)

	// Preserve terminal waiting states set by demo / HITL flows.
	if cur, _ := h.store.GetRun(run.ID); cur != nil {
		switch cur.Status {
		case "waiting_human", "waiting_approval", "cancelled":
			return
		}
	}

	status := "completed"
	errMsg := ""
	if ctx.Err() != nil {
		status = "cancelled"
		errMsg = "cancelled"
	} else if runErr != nil {
		status = "failed"
		errMsg = runErr.Error()
	}
	_ = h.store.UpdateRunStatus(run.ID, status, errMsg, "3/3")
	h.emitRaw(run.ID, "run.status", map[string]any{"status": status, "message": errMsg})
}

func (h *Host) runDemo(ctx context.Context, run store.Run, root string, emit func(providers.Event)) error {
	steps := []struct {
		delay time.Duration
		ev    providers.Event
	}{
		{200 * time.Millisecond, providers.Event{Type: "message.assistant", Payload: map[string]any{
			"text": "（演示模式）已读取工作区规则与数据路径约定，准备编写扫描脚本。",
		}}},
		{100 * time.Millisecond, providers.Event{Type: "plan.updated", Payload: map[string]any{
			"steps": []map[string]any{
				{"id": "1", "title": "扫描工作区结构", "state": "done", "durationMs": 200},
				{"id": "2", "title": "编写脚本", "state": "running"},
				{"id": "3", "title": "运行脚本", "state": "pending"},
			},
		}}},
		{150 * time.Millisecond, providers.Event{Type: "shell.start", Payload: map[string]any{
			"command": "echo her-dock-demo", "cwd": root, "class": "read_only",
		}}},
		{100 * time.Millisecond, providers.Event{Type: "shell.output", Payload: map[string]any{
			"stream": "stdout", "text": "her-dock-demo\n",
		}}},
		{100 * time.Millisecond, providers.Event{Type: "shell.exit", Payload: map[string]any{
			"exitCode": 0, "durationMs": 80,
		}}},
		{100 * time.Millisecond, providers.Event{Type: "file.edit_proposed", Payload: map[string]any{
			"path": "agents/store/outlier_scan.py", "kind": "A", "additions": 24, "deletions": 0,
		}}},
		{50 * time.Millisecond, providers.Event{Type: "file.edit_proposed", Payload: map[string]any{
			"path": "rules/口径.md", "kind": "M", "additions": 2, "deletions": 0,
		}}},
		{50 * time.Millisecond, providers.Event{Type: "table.result", Payload: map[string]any{
			"caption": "显著偏离门店（demo）",
			"columns": []map[string]any{
				{"key": "store", "label": "STORE"},
				{"key": "mom", "label": "MOM"},
				{"key": "flag", "label": "FLAG"},
			},
			"rows": []map[string]any{
				{"store": "杭州滨江店", "mom": "-34.2%", "flag": "待确认"},
				{"store": "南京江宁店", "mom": "-31.7%", "flag": "异常"},
			},
		}}},
		{50 * time.Millisecond, providers.Event{Type: "human.decision", Payload: map[string]any{
			"question": "商场改造期间的降幅是否计入异常？（demo）",
			"options": []map[string]any{
				{"id": "include", "label": "计入，标注原因", "primary": true},
				{"id": "exclude", "label": "排除"},
			},
		}}},
	}
	for _, s := range steps {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(s.delay):
			emit(s.ev)
		}
	}
	// write a demo artifact under out/
	_ = os.MkdirAll(filepath.Join(root, "out"), 0o755)
	art := filepath.Join(root, "out", "demo-result.txt")
	_ = os.WriteFile(art, []byte("demo outlier stores: 2\n"), 0o644)
	emit(providers.Event{Type: "artifact.created", Payload: map[string]any{
		"path": "out/demo-result.txt", "name": "demo-result.txt", "ext": "txt", "sizeBytes": 24,
	}})
	_ = h.store.UpdateRunStatus(run.ID, "waiting_human", "", "2/3")
	h.emitRaw(run.ID, "run.status", map[string]any{"status": "waiting_human", "message": "等待口径确认"})
	return nil
}

func (h *Host) requestApproval(runID, title, detail, risk, kind, scopeKey string) (string, error) {
	id := "appr_" + uuid.NewString()[:8]
	ch := make(chan string, 1)
	h.mu.Lock()
	h.approvals[id] = ch
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.approvals, id)
		h.mu.Unlock()
	}()

	h.emitRaw(runID, "approval.requested", map[string]any{
		"approvalId": id, "title": title, "detail": detail, "risk": risk, "kind": kind, "scopeKey": scopeKey,
	})
	_ = h.store.UpdateRunStatus(runID, "waiting_approval", "", "")
	h.emitRaw(runID, "run.status", map[string]any{"status": "waiting_approval"})

	select {
	case dec := <-ch:
		if dec == "always_allow" && scopeKey != "" {
			_ = h.store.SetAlwaysAllow(scopeKey)
		}
		h.emitRaw(runID, "approval.resolved", map[string]any{"approvalId": id, "decision": dec})
		_ = h.store.UpdateRunStatus(runID, "running", "", "")
		h.emitRaw(runID, "run.status", map[string]any{"status": "running"})
		return dec, nil
	case <-time.After(30 * time.Minute):
		return "deny", fmt.Errorf("approval timeout")
	}
}

func (h *Host) scanArtifacts(run store.Run, root string) {
	outDir := filepath.Join(root, "out")
	entries, err := os.ReadDir(outDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		name := e.Name()
		ext := strings.TrimPrefix(filepath.Ext(name), ".")
		id := "art_" + uuid.NewString()[:8]
		rel := "out/" + name
		_ = h.store.InsertArtifact(id, run.ID, run.WorkspaceID, rel, name, ext, info.Size(), store.Now())
		h.emitRaw(run.ID, "artifact.created", map[string]any{
			"path": rel, "name": name, "ext": ext, "sizeBytes": info.Size(),
		})
	}
}

func (h *Host) emitProvider(runID string, e providers.Event) {
	payload := map[string]any{}
	for k, v := range e.Payload {
		payload[k] = v
	}
	h.emitRaw(runID, e.Type, payload)
}

func (h *Host) emitRaw(runID, typ string, fields map[string]any) {
	seq, _ := h.store.NextEventSeq(runID)
	id := "ev_" + uuid.NewString()[:10]
	ts := store.Now()
	ev := map[string]any{
		"id": id, "runId": runID, "type": typ, "ts": ts, "seq": seq,
	}
	for k, v := range fields {
		ev[k] = v
	}
	_ = h.store.InsertEvent(id, runID, seq, typ, ts, ev)
	// wrap for SSE
	h.broadcast(map[string]any{"channel": "run:event", "event": ev})
}

func (h *Host) HumanDiffSummary(workspaceID string) (string, error) {
	w, err := h.store.GetWorkspace(workspaceID)
	if err != nil || w == nil {
		return "", fmt.Errorf("workspace not found")
	}
	// use git diff
	// shell package not needed
	cmdOut, err := runGitDiff(w.RootPath)
	if err != nil {
		return "Human edited files on disk (git unavailable).", nil
	}
	if strings.TrimSpace(cmdOut) == "" {
		return "No git diff; disk contents are source of truth.", nil
	}
	if len(cmdOut) > 8000 {
		cmdOut = cmdOut[:8000] + "\n…(truncated)"
	}
	return cmdOut, nil
}

func runGitDiff(root string) (string, error) {
	// local import cycle free
	return readCommand(root, "git", "diff", "HEAD")
}

func readCommand(dir string, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// reuse shell runner style
	type result struct {
		out string
		err error
	}
	ch := make(chan result, 1)
	go func() {
		// inline exec to avoid shell quoting
		// defined below via json unused import keep
		b, err := execOutput(ctx, dir, name, args...)
		ch <- result{string(b), err}
	}()
	r := <-ch
	return r.out, r.err
}

// keep json import used for debugging helpers
var _ = json.Marshal
