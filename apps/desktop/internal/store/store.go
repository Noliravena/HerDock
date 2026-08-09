package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  branch TEXT,
  dirty_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  plan_progress TEXT,
  error_message TEXT,
  token_usage TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  ts TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  label TEXT NOT NULL,
  snapshot_ref TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size_bytes INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS always_allow (
  scope_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_sessions_ws ON sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);
`)
	return err
}

func Now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

type Workspace struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	RootPath     string `json:"rootPath"`
	Branch       string `json:"branch,omitempty"`
	DirtySummary string `json:"dirtySummary,omitempty"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

func (s *Store) UpsertWorkspace(w Workspace) error {
	_, err := s.db.Exec(`
INSERT INTO workspaces(id,name,root_path,branch,dirty_summary,created_at,updated_at)
VALUES(?,?,?,?,?,?,?)
ON CONFLICT(root_path) DO UPDATE SET
  name=excluded.name, branch=excluded.branch, dirty_summary=excluded.dirty_summary, updated_at=excluded.updated_at
`, w.ID, w.Name, w.RootPath, w.Branch, w.DirtySummary, w.CreatedAt, w.UpdatedAt)
	return err
}

func (s *Store) ListWorkspaces() ([]Workspace, error) {
	rows, err := s.db.Query(`SELECT id,name,root_path,branch,dirty_summary,created_at,updated_at FROM workspaces ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Workspace
	for rows.Next() {
		var w Workspace
		var branch, dirty sql.NullString
		if err := rows.Scan(&w.ID, &w.Name, &w.RootPath, &branch, &dirty, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		w.Branch = branch.String
		w.DirtySummary = dirty.String
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *Store) GetWorkspace(id string) (*Workspace, error) {
	var w Workspace
	var branch, dirty sql.NullString
	err := s.db.QueryRow(`SELECT id,name,root_path,branch,dirty_summary,created_at,updated_at FROM workspaces WHERE id=?`, id).
		Scan(&w.ID, &w.Name, &w.RootPath, &branch, &dirty, &w.CreatedAt, &w.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	w.Branch = branch.String
	w.DirtySummary = dirty.String
	return &w, nil
}

func (s *Store) GetWorkspaceByPath(root string) (*Workspace, error) {
	var w Workspace
	var branch, dirty sql.NullString
	err := s.db.QueryRow(`SELECT id,name,root_path,branch,dirty_summary,created_at,updated_at FROM workspaces WHERE root_path=?`, root).
		Scan(&w.ID, &w.Name, &w.RootPath, &branch, &dirty, &w.CreatedAt, &w.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	w.Branch = branch.String
	w.DirtySummary = dirty.String
	return &w, nil
}

type Session struct {
	ID                string `json:"id"`
	WorkspaceID       string `json:"workspaceId"`
	Title             string `json:"title"`
	Kind              string `json:"kind"`
	ProviderID        string `json:"providerId"`
	ProviderSessionID string `json:"providerSessionId,omitempty"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}

func (s *Store) InsertSession(sess Session) error {
	_, err := s.db.Exec(`INSERT INTO sessions(id,workspace_id,title,kind,provider_id,provider_session_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
		sess.ID, sess.WorkspaceID, sess.Title, sess.Kind, sess.ProviderID, sess.ProviderSessionID, sess.CreatedAt, sess.UpdatedAt)
	return err
}

func (s *Store) ListSessions(workspaceID string) ([]Session, error) {
	rows, err := s.db.Query(`SELECT id,workspace_id,title,kind,provider_id,provider_session_id,created_at,updated_at FROM sessions WHERE workspace_id=? ORDER BY updated_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		var sess Session
		var ps sql.NullString
		if err := rows.Scan(&sess.ID, &sess.WorkspaceID, &sess.Title, &sess.Kind, &sess.ProviderID, &ps, &sess.CreatedAt, &sess.UpdatedAt); err != nil {
			return nil, err
		}
		sess.ProviderSessionID = ps.String
		out = append(out, sess)
	}
	return out, rows.Err()
}

func (s *Store) GetSession(id string) (*Session, error) {
	var sess Session
	var ps sql.NullString
	err := s.db.QueryRow(`SELECT id,workspace_id,title,kind,provider_id,provider_session_id,created_at,updated_at FROM sessions WHERE id=?`, id).
		Scan(&sess.ID, &sess.WorkspaceID, &sess.Title, &sess.Kind, &sess.ProviderID, &ps, &sess.CreatedAt, &sess.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sess.ProviderSessionID = ps.String
	return &sess, nil
}

func (s *Store) TouchSession(id string) error {
	_, err := s.db.Exec(`UPDATE sessions SET updated_at=? WHERE id=?`, Now(), id)
	return err
}

type Run struct {
	ID           string         `json:"id"`
	SessionID    string         `json:"sessionId"`
	WorkspaceID  string         `json:"workspaceId"`
	ProviderID   string         `json:"providerId"`
	Status       string         `json:"status"`
	Prompt       string         `json:"prompt"`
	PlanProgress string         `json:"planProgress,omitempty"`
	ErrorMessage string         `json:"errorMessage,omitempty"`
	TokenUsage   map[string]any `json:"tokenUsage,omitempty"`
	CreatedAt    string         `json:"createdAt"`
	UpdatedAt    string         `json:"updatedAt"`
	StartedAt    string         `json:"startedAt,omitempty"`
	FinishedAt   string         `json:"finishedAt,omitempty"`
}

func (s *Store) InsertRun(r Run) error {
	tu, _ := json.Marshal(r.TokenUsage)
	_, err := s.db.Exec(`INSERT INTO runs(id,session_id,workspace_id,provider_id,status,prompt,plan_progress,error_message,token_usage,created_at,updated_at,started_at,finished_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.ID, r.SessionID, r.WorkspaceID, r.ProviderID, r.Status, r.Prompt, r.PlanProgress, r.ErrorMessage, string(tu),
		r.CreatedAt, r.UpdatedAt, nullStr(r.StartedAt), nullStr(r.FinishedAt))
	return err
}

func (s *Store) UpdateRunStatus(id, status, errMsg, planProgress string) error {
	_, err := s.db.Exec(`UPDATE runs SET status=?, error_message=?, plan_progress=?, updated_at=?, finished_at=CASE WHEN ? IN ('completed','failed','cancelled') THEN ? ELSE finished_at END, started_at=COALESCE(started_at, CASE WHEN ?='running' THEN ? ELSE NULL END) WHERE id=?`,
		status, errMsg, planProgress, Now(), status, Now(), status, Now(), id)
	return err
}

func (s *Store) GetRun(id string) (*Run, error) {
	var r Run
	var plan, errMsg, tu sql.NullString
	var started, finished sql.NullString
	err := s.db.QueryRow(`SELECT id,session_id,workspace_id,provider_id,status,prompt,plan_progress,error_message,token_usage,created_at,updated_at,started_at,finished_at FROM runs WHERE id=?`, id).
		Scan(&r.ID, &r.SessionID, &r.WorkspaceID, &r.ProviderID, &r.Status, &r.Prompt, &plan, &errMsg, &tu, &r.CreatedAt, &r.UpdatedAt, &started, &finished)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.PlanProgress = plan.String
	r.ErrorMessage = errMsg.String
	r.StartedAt = started.String
	r.FinishedAt = finished.String
	if tu.Valid && tu.String != "" && tu.String != "null" {
		_ = json.Unmarshal([]byte(tu.String), &r.TokenUsage)
	}
	return &r, nil
}

func (s *Store) ListRuns(sessionID string) ([]Run, error) {
	rows, err := s.db.Query(`SELECT id,session_id,workspace_id,provider_id,status,prompt,plan_progress,error_message,token_usage,created_at,updated_at,started_at,finished_at FROM runs WHERE session_id=? ORDER BY created_at DESC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Run
	for rows.Next() {
		var r Run
		var plan, errMsg, tu sql.NullString
		var started, finished sql.NullString
		if err := rows.Scan(&r.ID, &r.SessionID, &r.WorkspaceID, &r.ProviderID, &r.Status, &r.Prompt, &plan, &errMsg, &tu, &r.CreatedAt, &r.UpdatedAt, &started, &finished); err != nil {
			return nil, err
		}
		r.PlanProgress = plan.String
		r.ErrorMessage = errMsg.String
		r.StartedAt = started.String
		r.FinishedAt = finished.String
		if tu.Valid && tu.String != "" && tu.String != "null" {
			_ = json.Unmarshal([]byte(tu.String), &r.TokenUsage)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) ListRecentRuns(limit int) ([]Run, error) {
	rows, err := s.db.Query(`SELECT id,session_id,workspace_id,provider_id,status,prompt,plan_progress,error_message,token_usage,created_at,updated_at,started_at,finished_at FROM runs ORDER BY updated_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Run
	for rows.Next() {
		var r Run
		var plan, errMsg, tu sql.NullString
		var started, finished sql.NullString
		if err := rows.Scan(&r.ID, &r.SessionID, &r.WorkspaceID, &r.ProviderID, &r.Status, &r.Prompt, &plan, &errMsg, &tu, &r.CreatedAt, &r.UpdatedAt, &started, &finished); err != nil {
			return nil, err
		}
		r.PlanProgress = plan.String
		r.ErrorMessage = errMsg.String
		r.StartedAt = started.String
		r.FinishedAt = finished.String
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) InsertEvent(id, runID string, seq int, typ, ts string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO events(id,run_id,seq,type,ts,payload) VALUES(?,?,?,?,?,?)`, id, runID, seq, typ, ts, string(b))
	return err
}

func (s *Store) ListEvents(runID string) ([]map[string]any, error) {
	rows, err := s.db.Query(`SELECT payload FROM events WHERE run_id=? ORDER BY seq ASC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(payload), &m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) NextEventSeq(runID string) (int, error) {
	var n sql.NullInt64
	err := s.db.QueryRow(`SELECT MAX(seq) FROM events WHERE run_id=?`, runID).Scan(&n)
	if err != nil {
		return 0, err
	}
	if !n.Valid {
		return 1, nil
	}
	return int(n.Int64) + 1, nil
}

func (s *Store) InsertCheckpoint(id, runID, label, ref, created string) error {
	_, err := s.db.Exec(`INSERT INTO checkpoints(id,run_id,label,snapshot_ref,created_at) VALUES(?,?,?,?,?)`, id, runID, label, ref, created)
	return err
}

func (s *Store) ListCheckpoints(runID string) ([]map[string]any, error) {
	rows, err := s.db.Query(`SELECT id,run_id,label,snapshot_ref,created_at FROM checkpoints WHERE run_id=? ORDER BY created_at DESC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, run, label, ref, created string
		if err := rows.Scan(&id, &run, &label, &ref, &created); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "runId": run, "label": label, "snapshotRef": ref, "createdAt": created,
		})
	}
	return out, rows.Err()
}

func (s *Store) InsertArtifact(id, runID, wsID, path, name, ext string, size int64, created string) error {
	_, err := s.db.Exec(`INSERT INTO artifacts(id,run_id,workspace_id,path,name,ext,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		id, runID, wsID, path, name, ext, size, created)
	return err
}

func (s *Store) ListArtifacts(workspaceID string) ([]map[string]any, error) {
	rows, err := s.db.Query(`SELECT id,run_id,workspace_id,path,name,ext,size_bytes,created_at FROM artifacts WHERE workspace_id=? ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, run, ws, path, name, ext, created string
		var size sql.NullInt64
		if err := rows.Scan(&id, &run, &ws, &path, &name, &ext, &size, &created); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "runId": run, "workspaceId": ws, "path": path, "name": name, "ext": ext,
			"sizeBytes": size.Int64, "createdAt": created,
		})
	}
	return out, rows.Err()
}

func (s *Store) SetAlwaysAllow(scopeKey string) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO always_allow(scope_key,created_at) VALUES(?,?)`, scopeKey, Now())
	return err
}

func (s *Store) HasAlwaysAllow(scopeKey string) (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(1) FROM always_allow WHERE scope_key=?`, scopeKey).Scan(&n)
	return n > 0, err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func MustID(prefix string) string {
	return fmt.Sprintf("%s_%s", prefix, time.Now().UTC().Format("20060102T150405.000000000"))
}
