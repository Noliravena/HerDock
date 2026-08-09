package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"time"

	"github.com/vantiboolean/her-dock/apps/desktop/internal/host"
	"github.com/vantiboolean/her-dock/apps/desktop/internal/policy"
)

// Options configures optional server features such as serving the built UI.
type Options struct {
	// UIDir, when set to an existing directory, serves the built workbench UI
	// at "/" so the desktop app renders the same interface as the web app.
	UIDir string
}

func ListenAndServe(addr string, h *host.Host) error {
	return ListenAndServeWithOptions(addr, h, Options{})
}

func ListenAndServeWithOptions(addr string, h *host.Host, opts Options) error {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "service": "her-dock-host", "ts": time.Now().UTC()})
	})

	mux.HandleFunc("/v1/platform", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, h.Platform())
	})

	mux.HandleFunc("/v1/skills", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, h.ListSkills(r.URL.Query().Get("workspaceId")))
	})

	mux.HandleFunc("/v1/queue", func(w http.ResponseWriter, r *http.Request) {
		list, err := h.RunQueue()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, list)
	})

	mux.HandleFunc("/v1/usage", func(w http.ResponseWriter, r *http.Request) {
		rep, err := h.Usage(r.URL.Query().Get("runId"))
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, rep)
	})

	mux.HandleFunc("/v1/schedules", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			list, err := h.ListSchedules(r.URL.Query().Get("workspaceId"))
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			writeJSON(w, list)
		case http.MethodPost:
			var body host.SaveScheduleReq
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			sc, err := h.SaveSchedule(body)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeJSON(w, sc)
		default:
			http.Error(w, "method not allowed", 405)
		}
	})

	mux.HandleFunc("/v1/schedules/", func(w http.ResponseWriter, r *http.Request) {
		parts := splitPath(r.URL.Path[len("/v1/schedules/"):])
		if len(parts) != 1 {
			http.Error(w, "not found", 404)
			return
		}
		if r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", 405)
			return
		}
		if err := h.DeleteSchedule(parts[0]); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	})

	mux.HandleFunc("/v1/providers", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, h.ListProviders())
	})

	mux.HandleFunc("/v1/policy", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			var b policy.Bundle
			if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			h.SetPolicy(b)
		}
		writeJSON(w, h.Policy())
	})

	mux.HandleFunc("/v1/connectors", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, h.ListConnectors())
	})

	mux.HandleFunc("/v1/workspaces", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			list, err := h.ListWorkspaces()
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			writeJSON(w, list)
		case http.MethodPost:
			var body struct {
				Path string `json:"path"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			ws, err := h.OpenWorkspace(body.Path)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeJSON(w, ws)
		default:
			http.Error(w, "method not allowed", 405)
		}
	})

	mux.HandleFunc("/v1/workspaces/", func(w http.ResponseWriter, r *http.Request) {
		// /v1/workspaces/{id}/tree|file|sessions|artifacts|diff-summary
		path := r.URL.Path[len("/v1/workspaces/"):]
		parts := splitPath(path)
		if len(parts) < 1 {
			http.Error(w, "not found", 404)
			return
		}
		id := parts[0]
		if len(parts) == 1 {
			http.Error(w, "not found", 404)
			return
		}
		switch parts[1] {
		case "tree":
			depth := 4
			if d := r.URL.Query().Get("depth"); d != "" {
				if n, err := strconv.Atoi(d); err == nil {
					depth = n
				}
			}
			tree, err := h.GetTree(id, depth)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeJSON(w, tree)
		case "file":
			rel := r.URL.Query().Get("path")
			if r.Method == http.MethodGet {
				content, err := h.ReadFile(id, rel)
				if err != nil {
					http.Error(w, err.Error(), 400)
					return
				}
				writeJSON(w, map[string]any{"path": rel, "content": content})
				return
			}
			if r.Method == http.MethodPut {
				var body struct {
					Path    string `json:"path"`
					Content string `json:"content"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					http.Error(w, err.Error(), 400)
					return
				}
				if err := h.WriteFile(id, body.Path, body.Content); err != nil {
					http.Error(w, err.Error(), 400)
					return
				}
				writeJSON(w, map[string]any{"ok": true})
				return
			}
			http.Error(w, "method not allowed", 405)
		case "sessions":
			if r.Method == http.MethodGet {
				list, err := h.ListSessions(id)
				if err != nil {
					http.Error(w, err.Error(), 500)
					return
				}
				writeJSON(w, list)
				return
			}
			if r.Method == http.MethodPost {
				var body host.CreateSessionReq
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					http.Error(w, err.Error(), 400)
					return
				}
				body.WorkspaceID = id
				sess, err := h.CreateSession(body)
				if err != nil {
					http.Error(w, err.Error(), 400)
					return
				}
				writeJSON(w, sess)
				return
			}
			http.Error(w, "method not allowed", 405)
		case "artifacts":
			list, err := h.ListArtifacts(id)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			writeJSON(w, list)
		case "diff-summary":
			s, err := h.HumanDiffSummary(id)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeJSON(w, map[string]any{"summary": s, "diskWins": true})
		case "file-diff":
			rel := r.URL.Query().Get("path")
			diff, err := h.FileDiff(id, rel)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeJSON(w, map[string]any{"path": rel, "diff": diff})
		case "context":
			ctx, err := h.GetWorkspaceContext(id)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeJSON(w, ctx)
		case "shell":
			var body struct {
				Command string `json:"command"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			res, err := h.RunShell(id, body.Command)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeJSON(w, res)
		default:
			http.Error(w, "not found", 404)
		}
	})

	mux.HandleFunc("/v1/sessions/", func(w http.ResponseWriter, r *http.Request) {
		// /v1/sessions/{id}/runs
		path := r.URL.Path[len("/v1/sessions/"):]
		parts := splitPath(path)
		if len(parts) != 2 || parts[1] != "runs" {
			http.Error(w, "not found", 404)
			return
		}
		list, err := h.ListRuns(parts[0])
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, list)
	})

	mux.HandleFunc("/v1/runs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			list, err := h.ListRecentRuns(50)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			writeJSON(w, list)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		var body host.StartRunReq
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		run, err := h.StartRun(body)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, run)
	})

	mux.HandleFunc("/v1/runs/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path[len("/v1/runs/"):]
		parts := splitPath(path)
		if len(parts) < 1 {
			http.Error(w, "not found", 404)
			return
		}
		id := parts[0]
		if len(parts) == 1 {
			// not implemented get single beyond events
			http.Error(w, "not found", 404)
			return
		}
		switch parts[1] {
		case "events":
			list, err := h.ListEvents(id)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			writeJSON(w, list)
		case "checkpoints":
			list, err := h.ListCheckpoints(id)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			writeJSON(w, list)
		case "cancel":
			if err := h.CancelRun(id); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeJSON(w, map[string]any{"ok": true})
		case "usage":
			rep, err := h.Usage(id)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			writeJSON(w, rep)
		case "decision":
			var body struct {
				OptionID string `json:"optionId"`
				FreeText string `json:"freeText"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
				http.Error(w, err.Error(), 400)
				return
			}
			if err := h.ResolveDecision(id, body.OptionID, body.FreeText); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeJSON(w, map[string]any{"ok": true})
		case "continue":
			var body host.ContinueRunReq
			body.RunID = id
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
				http.Error(w, err.Error(), 400)
				return
			}
			body.RunID = id
			run, err := h.ContinueRun(body)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			writeJSON(w, run)
		default:
			http.Error(w, "not found", 404)
		}
	})

	mux.HandleFunc("/v1/approvals/", func(w http.ResponseWriter, r *http.Request) {
		// /v1/approvals/{id}/resolve
		path := r.URL.Path[len("/v1/approvals/"):]
		parts := splitPath(path)
		if len(parts) != 2 || parts[1] != "resolve" {
			http.Error(w, "not found", 404)
			return
		}
		var body struct {
			Decision string `json:"decision"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := h.ResolveApproval(parts[0], body.Decision); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	})

	mux.HandleFunc("/v1/events", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "stream unsupported", 500)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		ch := h.Subscribe()
		defer h.Unsubscribe(ch)
		fmt.Fprintf(w, "event: hello\ndata: {\"ok\":true}\n\n")
		flusher.Flush()
		notify := r.Context().Done()
		for {
			select {
			case <-notify:
				return
			case ev, ok := <-ch:
				if !ok {
					return
				}
				b, _ := json.Marshal(ev)
				fmt.Fprintf(w, "data: %s\n\n", b)
				flusher.Flush()
			}
		}
	})

	if opts.UIDir != "" {
		if info, err := os.Stat(opts.UIDir); err == nil && info.IsDir() {
			mux.Handle("/", spaHandler(opts.UIDir))
		}
	}

	handler := withCORS(mux)
	return http.ListenAndServe(addr, handler)
}

// spaHandler serves the built workbench UI, falling back to index.html so the
// desktop shell can deep-link into any view.
func spaHandler(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	index := filepath.Join(dir, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Join(dir, filepath.FromSlash(path.Clean("/"+r.URL.Path)))
		if info, err := os.Stat(clean); err == nil && !info.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, index)
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func splitPath(p string) []string {
	var parts []string
	cur := ""
	for _, c := range p {
		if c == '/' {
			if cur != "" {
				parts = append(parts, cur)
				cur = ""
			}
			continue
		}
		cur += string(c)
	}
	if cur != "" {
		parts = append(parts, cur)
	}
	return parts
}
