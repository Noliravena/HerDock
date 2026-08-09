package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/vantiboolean/her-dock/apps/desktop/internal/host"
	"github.com/vantiboolean/her-dock/apps/desktop/internal/server"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:17890", "HTTP listen address")
	dataDir := flag.String("data", "", "data directory for sqlite (default: ~/.her-dock)")
	uiDir := flag.String("ui", "", "serve the built workbench UI from this directory (default: ../web/dist when present)")
	flag.Parse()

	dir := *dataDir
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatal(err)
		}
		dir = filepath.Join(home, ".her-dock")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Fatal(err)
	}

	h, err := host.New(dir)
	if err != nil {
		log.Fatal(err)
	}
	defer h.Close()

	ui := *uiDir
	if ui == "" {
		if guess := defaultUIDir(); guess != "" {
			ui = guess
		}
	}

	fmt.Printf("her-dock host listening on http://%s\n", *addr)
	fmt.Printf("data dir: %s\n", dir)
	if ui != "" {
		fmt.Printf("workbench UI: %s (open http://%s)\n", ui, *addr)
	}
	if err := server.ListenAndServeWithOptions(*addr, h, server.Options{UIDir: ui}); err != nil {
		log.Fatal(err)
	}
}

// defaultUIDir finds a built web bundle next to the binary or in the repo tree,
// so `go run .` in a dev checkout already serves the desktop UI.
func defaultUIDir() string {
	candidates := []string{
		filepath.Join("..", "web", "dist"),
		filepath.Join("apps", "web", "dist"),
		"ui",
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "ui"))
	}
	for _, c := range candidates {
		if info, err := os.Stat(filepath.Join(c, "index.html")); err == nil && !info.IsDir() {
			abs, err := filepath.Abs(c)
			if err == nil {
				return abs
			}
			return c
		}
	}
	return ""
}
