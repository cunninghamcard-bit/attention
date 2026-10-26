// Package cli is the CLI plugin (RFC 0001 §5.9): it listens on the socket
// the launcher's client connects to, with the existing wire format — one
// JSON line {argv, tty, cwd}, a plain-text reply, the socket closing to end
// it — and runs the invocation as a command.
package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
)

// Version is reported by `attention version`.
var Version = "0.1.0-dev"

type request struct {
	Argv []string `json:"argv"`
	TTY  bool     `json:"tty"`
	Cwd  string   `json:"cwd"`
}

// Plugin listens on paths.SocketPath while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "cli",
	Inject: []string{"actions"},
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		path := paths.SocketPath()
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		// The launcher's lock guarantees no other instance owns the path; a
		// file there is left over from a crash.
		os.Remove(path)
		ln, err := net.Listen("unix", path)
		if err != nil {
			return err
		}
		ctx.Effect(actionCleanup(actionsapi.Register(actionsapi.Command{
			ID: "version", CLI: true,
			Run: func(context.Context, actionsapi.Args) (string, error) { return Version, nil },
		})))
		ctx.Go(func(c context.Context) error {
			// Unloading cancels c and waits for this task before the Effect
			// runs: Accept has to be unblocked from here.
			go func() { <-c.Done(); ln.Close() }()
			for {
				conn, err := ln.Accept()
				if err != nil {
					if errors.Is(err, net.ErrClosed) {
						return nil
					}
					return err
				}
				go serve(c, conn)
			}
		})
		ctx.Effect(func(context.Context) error {
			dbg("cli: cleanup")
			ln.Close()
			if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			return nil
		})
		return nil
	},
})

func actionCleanup(off func()) func(context.Context) error {
	return func(context.Context) error { off(); return nil }
}

func serve(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return
	}
	var req request
	if err := json.Unmarshal(line, &req); err != nil {
		fmt.Fprintln(conn, "Error: malformed request")
		return
	}
	out, err := actionsapi.RunCLI(ctx, req.Argv, req.Cwd)
	if err != nil {
		fmt.Fprintf(conn, "Error: %s\n", err)
		return
	}
	if out != "" && !strings.HasSuffix(out, "\n") {
		out += "\n"
	}
	fmt.Fprint(conn, out)
}

func dbg(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
