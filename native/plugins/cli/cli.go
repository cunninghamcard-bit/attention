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
	"time"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/lifecycle"
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
		// Remove the socket only while it is still ours: a newer instance
		// may have replaced it (its launcher took the lock as ours died).
		ln.(*net.UnixListener).SetUnlinkOnClose(false)
		mine, err := os.Stat(path)
		if err != nil {
			ln.Close()
			return err
		}
		// quit is here, loaded in every profile, as closing the window:
		// headless has no window, and no workspace.
		ctx.Effect(actionCleanup(actionsapi.Register(QuitCommand())))
		ctx.Effect(actionCleanup(actionsapi.Register(actionsapi.Command{
			ID: "version", CLI: true,
			// The TS CLI's shape: "<version> (installer <build>)".
			Run: func(context.Context, actionsapi.Args) (string, error) {
				return Version + " (installer " + Version + ")", nil
			},
		})))
		ctx.Go(func(c context.Context) error {
			// Unloading cancels c and waits for this task before the Effect
			// runs: Accept has to be unblocked from here.
			go func() { <-c.Done(); ln.Close() }()
			for {
				conn, err := ln.Accept()
				if err != nil {
					if errors.Is(err, net.ErrClosed) || c.Err() != nil {
						return nil
					}
					// A passing failure (EMFILE, …) must not end the listener.
					dbg("cli: accept: %v", err)
					select {
					case <-c.Done():
						return nil
					case <-time.After(100 * time.Millisecond):
					}
					continue
				}
				go serve(c, conn)
			}
		})
		ctx.Effect(func(context.Context) error {
			dbg("cli: cleanup")
			ln.Close()
			if now, err := os.Stat(path); err == nil && os.SameFile(now, mine) {
				return os.Remove(path)
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

// QuitCommand is quit (Ctrl Q, the CLI's quit): the same path as the
// user closing the window, through the runtime's lifecycle.
func QuitCommand() actionsapi.Command {
	return actionsapi.Command{ID: "quit", Title: "Quit", Keys: "Ctrl Q", CLI: true,
		Main: func() { lifecycle.Quit() },
		Run: func(context.Context, actionsapi.Args) (string, error) {
			if !lifecycle.Quit() {
				return "", fmt.Errorf("This runtime cannot quit.")
			}
			return "Quitting.", nil
		}}
}
