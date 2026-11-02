// Package cli is the CLI plugin (RFC 0001 §5.9).
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

	"github.com/cunninghamcard-bit/attention/native/internal/lifecycle"
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
)

var (
	// Version is reported by `attention version`.
	Version = "0.1.0-dev"

	// Plugin listens on paths.SocketPath while loaded.
	Plugin = rutis.Define(rutis.Plugin[struct{}]{
		Name:   "cli",
		Inject: []string{"actions"},
		Apply: func(ctx *rutis.Ctx, _ struct{}) error {
			var act *actions.Service
			if err := ctx.Use("actions", &act); err != nil {
				return err
			}
			path := paths.SocketPath()
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				return err
			}
			os.Remove(path)
			ln, err := net.Listen("unix", path)
			if err != nil {
				return err
			}
			ln.(*net.UnixListener).SetUnlinkOnClose(false)
			mine, err := os.Stat(path)
			if err != nil {
				ln.Close()
				return err
			}
			ctx.Effect(actionCleanup(act.Add(QuitCommand())))
			ctx.Effect(actionCleanup(act.Add(actions.Command{
				ID: "version", CLI: true,
				Run: func(context.Context, actions.Args) (string, error) {
					return Version + " (installer " + Version + ")", nil
				},
			})))
			ctx.Go(func(c context.Context) error {
				go func() { <-c.Done(); ln.Close() }()
				for {
					conn, err := ln.Accept()
					if err != nil {
						if errors.Is(err, net.ErrClosed) || c.Err() != nil {
							return nil
						}
						dbg("cli: accept: %v", err)
						select {
						case <-c.Done():
							return nil
						case <-time.After(100 * time.Millisecond):
						}
						continue
					}
					go serve(c, act, conn)
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
)

type request struct {
	Argv []string `json:"argv"`
	TTY  bool     `json:"tty"`
	Cwd  string   `json:"cwd"`
}

// QuitCommand is quit (Ctrl Q, the CLI's quit).
func QuitCommand() actions.Command {
	return actions.Command{ID: "quit", Title: "Quit", Keys: "Ctrl Q", CLI: true,
		Main: func() { lifecycle.Quit() },
		Run: func(context.Context, actions.Args) (string, error) {
			if !lifecycle.Quit() {
				return "", fmt.Errorf("This runtime cannot quit.")
			}
			return "Quitting.", nil
		}}
}

func actionCleanup(off func()) func(context.Context) error {
	return func(context.Context) error { off(); return nil }
}

func serve(ctx context.Context, act *actions.Service, conn net.Conn) {
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	var req request
	if err := json.Unmarshal(line, &req); err != nil {
		fmt.Fprintln(conn, "Error: malformed request")
		return
	}
	out, err := act.RunCLI(ctx, req.Argv, req.Cwd)
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
