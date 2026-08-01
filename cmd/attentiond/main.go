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
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/cunninghamcard-bit/Attention/internal/accounts"
	"github.com/cunninghamcard-bit/Attention/internal/db"
	"github.com/cunninghamcard-bit/Attention/internal/handlers"
	"github.com/cunninghamcard-bit/Attention/internal/server"
	"github.com/cunninghamcard-bit/Attention/internal/store"
	"github.com/cunninghamcard-bit/Attention/internal/syncd"
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
	secret := os.Getenv("ATTENTIOND_JWT_SECRET")
	if secret == "" {
		// Dev fallback: sessions die with the process. Deployments set it.
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			logger.Error("no entropy for jwt secret", slog.Any("error", err))
			os.Exit(1)
		}
		secret = hex.EncodeToString(buf)
		logger.Warn("ATTENTIOND_JWT_SECRET not set; generated an ephemeral one")
	}

	st := store.New(pool)
	acc := accounts.New(pool, secret, 24*time.Hour)
	engine := syncd.New(st, accounts.SyncAuthorizer{Accounts: acc, Secret: secret}, logger)

	srv := server.New(logger, addr, secret,
		&handlers.HealthHandler{Ping: func() error { return pool.Ping(ctx) }},
		&handlers.AuthHandler{Accounts: acc},
		&handlers.VaultsHandler{Accounts: acc, Store: st},
		&handlers.SyncHandler{Engine: engine},
		&handlers.StaticHandler{Dir: os.Getenv("ATTENTIOND_WEB_DIST")},
	)
	if err := srv.Start(); err != nil {
		logger.Error("server stopped", slog.Any("error", err))
		os.Exit(1)
	}
}
