// Input: internal/db, net/http
// Output: attentiond main
// Pos: Server binary
//
// 🔄 Self-reference: When this file changes, update this header

// attentiond is the hosted-service binary from the data-layer spec
// (docs/superpowers/specs/2026-08-02-data-layer-server-design.md), shaped
// like Memoh's server: one binary that is also its own migration tool.
// Deliberately not part of `along` — a deployed sync server must not drag
// the agent harness with it.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"github.com/cunninghamcard-bit/Attention/internal/db"
)

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	switch cmd {
	case "serve":
		runServe()
	case "migrate":
		out, err := db.Migrate(databaseURL(), os.Args[2:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(out)
	case "version":
		fmt.Println("attentiond dev")
	default:
		fmt.Fprintf(os.Stderr,
			"Usage: attentiond <command>\n\nCommands:\n"+
				"  serve     Start the server (default)\n"+
				"  migrate   Run database migrations (up|down|version|force N)\n"+
				"  version   Print version information\n")
		os.Exit(1)
	}
}

func databaseURL() string {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn
	}
	// The devenv compose default (devenv/docker-compose.yml).
	return "postgres://attention:attention@127.0.0.1:5433/attention?sslmode=disable"
}

// ponytail: S1 serve is a health endpoint over a live DB connection — proof
// the binary boots against Postgres. The echo shell with real routes is S3.
func runServe() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	ctx := context.Background()
	pool, err := db.Connect(ctx, databaseURL())
	if err != nil {
		logger.Error("database unreachable", slog.Any("error", err))
		os.Exit(1)
	}
	defer pool.Close()

	addr := os.Getenv("ATTENTIOND_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8788"
	}
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, "db unreachable", http.StatusServiceUnavailable)
			return
		}
		fmt.Fprintln(w, "ok")
	})
	logger.Info("attentiond listening", slog.String("addr", addr))
	if err := http.ListenAndServe(addr, nil); err != nil {
		logger.Error("server stopped", slog.Any("error", err))
		os.Exit(1)
	}
}
