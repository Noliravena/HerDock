package host

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/vantiboolean/her-dock/apps/desktop/internal/store"
)

// PlatformInfo drives the platform chrome in the workbench UI
// (browser bar on web, traffic lights on macOS, caption buttons on Windows).
type PlatformInfo struct {
	OS            string `json:"os"`
	Arch          string `json:"arch"`
	Desktop       bool   `json:"desktop"`
	Chrome        string `json:"chrome"` // web | mac | win
	HomeDir       string `json:"homeDir,omitempty"`
	DataDir       string `json:"dataDir"`
	PathSeparator string `json:"pathSeparator"`
	ModifierKey   string `json:"modifierKey"`   // ⌘ | Ctrl
	CommandHint   string `json:"commandHint"`   // ⌘K | Ctrl K
	NewHint       string `json:"newHint"`       // ⌘N | Ctrl N
	SubmitHint    string `json:"submitHint"`    // ⌘⏎ | Ctrl ⏎
	DefaultShell  string `json:"defaultShell"`  // zsh | PowerShell | bash
	WindowControl string `json:"windowControl"` // left | right | none
}

// Platform reports the host operating system so the UI can render native chrome.
func (h *Host) Platform() PlatformInfo {
	home, _ := os.UserHomeDir()
	info := PlatformInfo{
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		Desktop:       true,
		HomeDir:       home,
		DataDir:       h.dataDir,
		PathSeparator: string(filepath.Separator),
	}
	switch runtime.GOOS {
	case "darwin":
		info.Chrome = "mac"
		info.ModifierKey = "⌘"
		info.CommandHint = "⌘K"
		info.NewHint = "⌘N"
		info.SubmitHint = "⌘⏎"
		info.DefaultShell = "zsh"
		info.WindowControl = "left"
	case "windows":
		info.Chrome = "win"
		info.ModifierKey = "Ctrl"
		info.CommandHint = "Ctrl K"
		info.NewHint = "Ctrl N"
		info.SubmitHint = "Ctrl ⏎"
		info.DefaultShell = "PowerShell"
		info.WindowControl = "right"
	default:
		info.Chrome = "win"
		info.ModifierKey = "Ctrl"
		info.CommandHint = "Ctrl K"
		info.NewHint = "Ctrl N"
		info.SubmitHint = "Ctrl ⏎"
		info.DefaultShell = "bash"
		info.WindowControl = "right"
	}
	return info
}

// Skill mirrors the 技能 cards in the right panel.
type Skill struct {
	ID     string `json:"id"`
	Glyph  string `json:"glyph"`
	Name   string `json:"name"`
	Status string `json:"status"` // enabled | readonly | limited | disabled
	Detail string `json:"detail"`
}

// ListSkills returns the built-in skill catalogue, enriched by workspace config.
func (h *Host) ListSkills(workspaceID string) []Skill {
	skills := []Skill{
		{ID: "table", Glyph: "表", Name: "表格分析", Status: "enabled", Detail: "读取 xlsx/csv，做聚合、透视与异常检测。"},
		{ID: "code", Glyph: "码", Name: "代码执行", Status: "enabled", Detail: "在工作区沙箱里运行脚本，产物写入 out/。"},
		{ID: "warehouse", Glyph: "库", Name: "数据仓库", Status: "readonly", Detail: "只读副本，用于核对线上口径。"},
		{ID: "doc", Glyph: "文", Name: "文档生成", Status: "enabled", Detail: "按 rules/ 模板输出摘要与周报。"},
		{ID: "web", Glyph: "网", Name: "网页抓取", Status: "limited", Detail: "仅允许白名单域名，需逐次确认。"},
		{ID: "search", Glyph: "知", Name: "知识检索", Status: "enabled", Detail: "检索工作区内历史结论与纪要。"},
	}
	if !h.policy.NetworkDefaultDeny {
		skills[4].Status = "enabled"
	}
	cfg := h.workspaceConfig(workspaceID)
	for _, extra := range cfg.Skills {
		skills = append(skills, Skill{
			ID:     extra,
			Glyph:  glyphFor(extra),
			Name:   extra,
			Status: "enabled",
			Detail: "来自 xingzhi.yml",
		})
	}
	return skills
}

func glyphFor(name string) string {
	for _, r := range name {
		return string(r)
	}
	return "·"
}

// WorkspaceContextFile is one entry of the 已加载上下文 list.
type WorkspaceContextFile struct {
	Path string `json:"path"`
	Kind string `json:"kind"` // rule | data | code | config
	Size string `json:"size"`
}

// WorkspaceContext feeds the 上下文 tab: loaded files, rules and token budget.
type WorkspaceContext struct {
	Files       []WorkspaceContextFile `json:"files"`
	Rules       []string               `json:"rules"`
	OutputDir   string                 `json:"outputDir"`
	TestCommand string                 `json:"testCommand,omitempty"`
	AutoExecute string                 `json:"autoExecute,omitempty"`
}

// GetWorkspaceContext collects rule files, data globs and config from xingzhi.yml.
func (h *Host) GetWorkspaceContext(workspaceID string) (*WorkspaceContext, error) {
	w, err := h.store.GetWorkspace(workspaceID)
	if err != nil || w == nil {
		return nil, fmt.Errorf("workspace not found")
	}
	cfg := h.workspaceConfig(workspaceID)
	ctx := &WorkspaceContext{
		Files:       []WorkspaceContextFile{},
		Rules:       []string{},
		OutputDir:   cfg.OutputDir,
		TestCommand: cfg.TestCommand,
		AutoExecute: cfg.AutoExecute,
	}
	seen := map[string]bool{}
	add := func(rel, kind string) {
		if rel == "" || seen[rel] {
			return
		}
		seen[rel] = true
		abs := filepath.Join(w.RootPath, filepath.FromSlash(rel))
		info, err := os.Stat(abs)
		if err != nil || info.IsDir() {
			return
		}
		ctx.Files = append(ctx.Files, WorkspaceContextFile{Path: rel, Kind: kind, Size: humanSize(info.Size())})
	}
	for _, pattern := range cfg.Rules {
		for _, rel := range globWorkspace(w.RootPath, pattern) {
			add(rel, "rule")
			if body, err := os.ReadFile(filepath.Join(w.RootPath, filepath.FromSlash(rel))); err == nil {
				ctx.Rules = append(ctx.Rules, ruleBullets(string(body))...)
			}
		}
	}
	for _, pattern := range cfg.DataGlobs {
		for _, rel := range globWorkspace(w.RootPath, pattern) {
			add(rel, "data")
		}
	}
	add("xingzhi.yml", "config")
	if len(ctx.Rules) == 0 {
		ctx.Rules = []string{
			"组织策略优先；xingzhi.yml 只能收紧，不能放宽。",
			"人手在磁盘上的修改优先于未采纳的 Agent 补丁。",
			"写入 secrets/ 与 .env 默认拒绝。",
			"网络默认拒绝，仅连接器域名可放行。",
		}
	}
	if len(ctx.Rules) > 12 {
		ctx.Rules = ctx.Rules[:12]
	}
	return ctx, nil
}

// ruleBullets extracts markdown list items as displayable workspace rules.
func ruleBullets(body string) []string {
	var out []string
	for _, line := range strings.Split(body, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "- ") || strings.HasPrefix(t, "* ") {
			t = strings.TrimSpace(t[2:])
			if t != "" {
				out = append(out, t)
			}
		}
	}
	return out
}

func humanSize(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	default:
		return fmt.Sprintf("%d B", n)
	}
}

// globWorkspace resolves a simple `a/**/*.md` style glob to workspace-relative paths.
func globWorkspace(root, pattern string) []string {
	pattern = filepath.ToSlash(strings.TrimPrefix(pattern, "./"))
	var out []string
	prefix := pattern
	if i := strings.Index(pattern, "*"); i >= 0 {
		prefix = pattern[:i]
	}
	if i := strings.LastIndex(prefix, "/"); i >= 0 {
		prefix = prefix[:i]
	} else {
		prefix = ""
	}
	base := filepath.Join(root, filepath.FromSlash(prefix))
	_ = filepath.WalkDir(base, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if matchSimpleGlob(pattern, rel) {
			out = append(out, rel)
		}
		return nil
	})
	sort.Strings(out)
	if len(out) > 20 {
		out = out[:20]
	}
	return out
}

func matchSimpleGlob(pattern, path string) bool {
	if pattern == path {
		return true
	}
	if !strings.Contains(pattern, "*") {
		return false
	}
	segments := strings.Split(pattern, "**/")
	if len(segments) == 2 {
		head, tail := segments[0], segments[1]
		if !strings.HasPrefix(path, head) {
			return false
		}
		rest := strings.TrimPrefix(path, head)
		for {
			if ok, _ := filepath.Match(tail, rest); ok {
				return true
			}
			i := strings.Index(rest, "/")
			if i < 0 {
				return false
			}
			rest = rest[i+1:]
		}
	}
	ok, _ := filepath.Match(pattern, path)
	return ok
}

// workspaceCfg is the parsed subset of xingzhi.yml that the workbench UI needs.
type workspaceCfg struct {
	Name            string
	DefaultProvider string
	DefaultKind     string
	AutoExecute     string
	Rules           []string
	Skills          []string
	DataGlobs       []string
	OutputDir       string
	TestCommand     string
}

func defaultWorkspaceCfg() workspaceCfg {
	return workspaceCfg{
		DefaultProvider: "codex",
		DefaultKind:     "mixed",
		AutoExecute:     "ask_risky",
		Rules:           []string{"rules/**/*.md", "AGENTS.md"},
		DataGlobs:       []string{"data/**/*"},
		OutputDir:       "out",
	}
}

func (h *Host) workspaceConfig(workspaceID string) workspaceCfg {
	cfg := defaultWorkspaceCfg()
	if workspaceID == "" {
		return cfg
	}
	w, err := h.store.GetWorkspace(workspaceID)
	if err != nil || w == nil {
		return cfg
	}
	body, err := os.ReadFile(filepath.Join(w.RootPath, "xingzhi.yml"))
	if err != nil {
		return cfg
	}
	return parseWorkspaceYAML(string(body), cfg)
}

// parseWorkspaceYAML reads the flat subset of YAML used by xingzhi.yml
// (scalar keys, one level of nesting, and `- item` sequences).
func parseWorkspaceYAML(body string, cfg workspaceCfg) workspaceCfg {
	var section string
	var listKey string
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimRight(raw, " \t\r")
		if line == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " "))
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "- ") {
			item := unquoteYAML(strings.TrimSpace(trimmed[2:]))
			switch listKey {
			case "rules":
				cfg.Rules = appendUnique(cfg.Rules, item)
			case "skills":
				cfg.Skills = appendUnique(cfg.Skills, item)
			case "dataGlobs":
				cfg.DataGlobs = appendUnique(cfg.DataGlobs, item)
			}
			continue
		}

		key, value, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = unquoteYAML(strings.TrimSpace(value))
		if indent == 0 {
			section = ""
		}
		if value == "" {
			if indent == 0 {
				section = key
			}
			listKey = key
			if key == "rules" || key == "skills" {
				// reset defaults when the file declares its own list
				if key == "rules" {
					cfg.Rules = nil
				} else {
					cfg.Skills = nil
				}
			}
			if key == "dataGlobs" {
				cfg.DataGlobs = nil
			}
			continue
		}
		listKey = ""
		switch {
		case indent == 0 && key == "name":
			cfg.Name = value
		case indent == 0 && key == "defaultProvider":
			cfg.DefaultProvider = value
		case indent == 0 && key == "defaultKind":
			cfg.DefaultKind = value
		case indent == 0 && key == "autoExecute":
			cfg.AutoExecute = value
		case section == "analysis" && key == "outputDir":
			cfg.OutputDir = value
		case section == "coding" && key == "testCommand":
			cfg.TestCommand = value
		}
	}
	return cfg
}

func appendUnique(list []string, item string) []string {
	if item == "" {
		return list
	}
	for _, x := range list {
		if x == item {
			return list
		}
	}
	return append(list, item)
}

func unquoteYAML(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	if i := strings.Index(s, " #"); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	return s
}

// ListSchedules returns 定时任务 rows, seeding defaults on first use.
func (h *Host) ListSchedules(workspaceID string) ([]store.Schedule, error) {
	list, err := h.store.ListSchedules(workspaceID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].NextRunAt = nextCronRun(list[i].Cron, time.Now())
	}
	return list, nil
}

type SaveScheduleReq struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	Name        string `json:"name"`
	Cron        string `json:"cron"`
	Prompt      string `json:"prompt"`
	ProviderID  string `json:"providerId"`
	Enabled     *bool  `json:"enabled"`
}

// SaveSchedule creates or updates a scheduled run.
func (h *Host) SaveSchedule(req SaveScheduleReq) (*store.Schedule, error) {
	if req.WorkspaceID == "" {
		return nil, fmt.Errorf("workspaceId required")
	}
	sc := store.Schedule{
		ID:          req.ID,
		WorkspaceID: req.WorkspaceID,
		Name:        req.Name,
		Cron:        req.Cron,
		Prompt:      req.Prompt,
		ProviderID:  req.ProviderID,
		Enabled:     true,
		CreatedAt:   store.Now(),
		UpdatedAt:   store.Now(),
	}
	if sc.ID != "" {
		prev, err := h.store.GetSchedule(sc.ID)
		if err != nil {
			return nil, err
		}
		if prev != nil {
			sc.CreatedAt = prev.CreatedAt
			sc.Enabled = prev.Enabled
			sc.LastRunAt = prev.LastRunAt
			if sc.Name == "" {
				sc.Name = prev.Name
			}
			if sc.Cron == "" {
				sc.Cron = prev.Cron
			}
			if sc.Prompt == "" {
				sc.Prompt = prev.Prompt
			}
			if sc.ProviderID == "" {
				sc.ProviderID = prev.ProviderID
			}
		}
	} else {
		sc.ID = "sched_" + uuid.NewString()[:8]
	}
	if req.Enabled != nil {
		sc.Enabled = *req.Enabled
	}
	if sc.Name == "" {
		sc.Name = "定时任务"
	}
	if sc.Cron == "" {
		sc.Cron = "0 7 * * *"
	}
	sc.NextRunAt = nextCronRun(sc.Cron, time.Now())
	if err := h.store.UpsertSchedule(sc); err != nil {
		return nil, err
	}
	return &sc, nil
}

func (h *Host) DeleteSchedule(id string) error { return h.store.DeleteSchedule(id) }

// UsageBucket is one row of the 算力用量 card.
type UsageBucket struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Tokens int    `json:"tokens"`
	Runs   int    `json:"runs"`
	Calls  int    `json:"calls"`
	Limit  int    `json:"limit,omitempty"`
}

type UsageReport struct {
	Buckets []UsageBucket `json:"buckets"`
	Credits int           `json:"credits"`
	Context struct {
		Used  int `json:"used"`
		Limit int `json:"limit"`
	} `json:"context"`
}

// Usage aggregates token spend for the current run, today and this month.
func (h *Host) Usage(runID string) (*UsageReport, error) {
	rep := &UsageReport{Buckets: []UsageBucket{}}
	now := time.Now()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).UTC().Format(time.RFC3339Nano)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).UTC().Format(time.RFC3339Nano)

	if runID != "" {
		row, err := h.store.RunUsage(runID)
		if err == nil {
			rep.Buckets = append(rep.Buckets, UsageBucket{
				Key: "run", Label: "本次会话", Tokens: row.Tokens, Runs: 1, Calls: row.Calls,
			})
			rep.Context.Used = row.Tokens
		}
	}
	today, err := h.store.AggregateUsage(dayStart)
	if err != nil {
		return nil, err
	}
	rep.Buckets = append(rep.Buckets, UsageBucket{
		Key: "today", Label: "今天", Tokens: today.Tokens, Runs: today.Runs, Calls: today.Calls,
	})
	month, err := h.store.AggregateUsage(monthStart)
	if err != nil {
		return nil, err
	}
	rep.Buckets = append(rep.Buckets, UsageBucket{
		Key: "month", Label: "本月额度", Tokens: month.Tokens, Runs: month.Runs, Calls: month.Calls, Limit: 50000,
	})
	rep.Credits = month.Tokens / 1000
	rep.Context.Limit = 200000
	return rep, nil
}

// QueueItem is one row of the status-bar 运行队列 popover.
type QueueItem struct {
	RunID       string `json:"runId"`
	Name        string `json:"name"`
	WorkspaceID string `json:"workspaceId"`
	Status      string `json:"status"`
	Meta        string `json:"meta"`
}

// RunQueue lists runs that are still in flight or awaiting a human.
func (h *Host) RunQueue() ([]QueueItem, error) {
	runs, err := h.store.ListRecentRuns(50)
	if err != nil {
		return nil, err
	}
	out := []QueueItem{}
	for _, r := range runs {
		switch r.Status {
		case "queued", "starting", "running", "waiting_approval", "waiting_human", "paused":
		default:
			continue
		}
		name := r.Prompt
		if len([]rune(name)) > 24 {
			name = string([]rune(name)[:24]) + "…"
		}
		meta := r.ID
		if r.PlanProgress != "" {
			meta += " · " + r.PlanProgress
		}
		out = append(out, QueueItem{
			RunID: r.ID, Name: name, WorkspaceID: r.WorkspaceID, Status: r.Status, Meta: meta,
		})
	}
	return out, nil
}

// ResolveDecision records the human answer to a human.decision card
// and returns the run to waiting state so the UI can continue it.
func (h *Host) ResolveDecision(runID, optionID, freeText string) error {
	run, err := h.store.GetRun(runID)
	if err != nil || run == nil {
		return fmt.Errorf("run not found")
	}
	h.emitRaw(runID, "human.decision", map[string]any{
		"question":         "已回复",
		"options":          []map[string]any{},
		"selectedOptionId": optionID,
		"freeText":         freeText,
	})
	text := optionID
	if freeText != "" {
		text = freeText
	}
	h.emitRaw(runID, "message.user", map[string]any{"text": text})
	return nil
}

// nextCronRun evaluates a 5-field cron expression and returns the next fire time.
// Non-cron strings (human labels) return an empty string.
func nextCronRun(expr string, from time.Time) string {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return ""
	}
	t := from.Truncate(time.Minute).Add(time.Minute)
	for i := 0; i < 366*24*60; i++ {
		if cronMatch(fields[0], t.Minute()) &&
			cronMatch(fields[1], t.Hour()) &&
			cronMatch(fields[2], t.Day()) &&
			cronMatch(fields[3], int(t.Month())) &&
			cronMatch(fields[4], int(t.Weekday())) {
			return t.Format(time.RFC3339)
		}
		t = t.Add(time.Minute)
	}
	return ""
}

func cronMatch(field string, value int) bool {
	if field == "*" || field == "?" {
		return true
	}
	for _, part := range strings.Split(field, ",") {
		step := 1
		if base, s, ok := strings.Cut(part, "/"); ok {
			n, err := strconv.Atoi(s)
			if err != nil || n <= 0 {
				continue
			}
			step = n
			part = base
			if part == "*" || part == "" {
				if value%step == 0 {
					return true
				}
				continue
			}
		}
		if lo, hi, ok := strings.Cut(part, "-"); ok {
			a, err1 := strconv.Atoi(lo)
			b, err2 := strconv.Atoi(hi)
			if err1 != nil || err2 != nil {
				continue
			}
			if value >= a && value <= b && (value-a)%step == 0 {
				return true
			}
			continue
		}
		n, err := strconv.Atoi(part)
		if err == nil && n == value {
			return true
		}
	}
	return false
}
