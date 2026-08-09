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

	fmt.Printf("her-dock host listening on http://%s\n", *addr)
	fmt.Printf("data dir: %s\n", dir)
	if err := server.ListenAndServe(*addr, h); err != nil {
		log.Fatal(err)
	}
}
