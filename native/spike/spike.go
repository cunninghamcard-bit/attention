// Package spike is the P0 topology spike (RFC 0001 §5.3, roadmap P0):
// in-process and cross-process rutis services, a callback that crosses
// processes, a CLI socket, and a mygo window, all in one UI runtime.
package spike

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// Hello is the in-process service's contract.
type Hello struct {
	Greet func(ctx context.Context, name string) (string, error)
}

// Clock is the out-of-process service's contract (cmd/clock).
type Clock struct {
	Now       func(ctx context.Context) (string, error)
	Subscribe func(ctx context.Context, n int, onTick func(ctx context.Context, tick string) error) error
}

var (
	mu    sync.Mutex
	lines []string
	// Win is the spike's window, set on the main thread once the app is ready.
	Win *mygo.Window
)

// Log records a line on stderr, in SPIKE_LOG when set, and in the window.
func Log(format string, args ...any) {
	line := fmt.Sprintf("%s [%d] %s", time.Now().Format("15:04:05.000"), os.Getpid(), fmt.Sprintf(format, args...))
	if path := os.Getenv("SPIKE_LOG"); path != "" {
		if f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			fmt.Fprintln(f, line)
			f.Close()
		}
	}
	// stderr is a pipe to rutis-host; once the host is gone this write fails
	// (EPIPE, with SIGPIPE ignored by the runtime) and is dropped.
	fmt.Fprintln(os.Stderr, line)
	mu.Lock()
	lines = append(lines, line)
	w := Win
	mu.Unlock()
	if w != nil {
		w.Invalidate()
	}
}

// SetWindow publishes the window so later lines redraw it.
func SetWindow(w *mygo.Window) {
	mu.Lock()
	Win = w
	mu.Unlock()
}

// View draws the log.
func View(c *ui.Context) {
	mu.Lock()
	shown := append([]string(nil), lines...)
	mu.Unlock()
	ui.Column(c).Fill().Padding(16).Gap(4).Children(func() {
		ui.Text(c, "attention P0 topology spike").Bold()
		for _, l := range shown {
			ui.Text(c, l).FontSize(12)
		}
	})
}

// SocketPath is where the spike's CLI listens.
func SocketPath() string {
	base := os.Getenv("XDG_RUNTIME_DIR")
	if base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "attention-spike.sock")
}

type helloImpl struct{}

func (helloImpl) Greet(_ context.Context, name string) (string, error) {
	return fmt.Sprintf("hello, %s (from pid %d)", name, os.Getpid()), nil
}

// HelloPlugin provides "hello" inside the UI runtime.
var HelloPlugin = rutis.Define(rutis.Plugin[struct{}]{
	Name: "hello",
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		ctx.Provide("hello", helloImpl{})
		ctx.Effect(func(context.Context) error { Log("hello: cleanup ran"); return nil })
		Log("hello: applied")
		return nil
	},
})

// UIPlugin uses both services the way a UI plugin would.
var UIPlugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "ui",
	Inject: []string{"hello", "clock"},
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		var hs, cs *rutis.Service
		if err := ctx.Use("hello", &hs); err != nil {
			return err
		}
		if err := ctx.Use("clock", &cs); err != nil {
			return err
		}
		Log("ui: hello Local()=%v, clock Local()=%v", hs.Local(), cs.Local())
		var hello Hello
		var clock Clock
		if err := ctx.Use("hello", &hello); err != nil {
			return err
		}
		if err := ctx.Use("clock", &clock); err != nil {
			return err
		}
		ctx.Go(func(c context.Context) error {
			t := time.Now()
			g, err := hello.Greet(c, "ui")
			Log("ui: Greet -> %q err=%v in %s", g, err, time.Since(t))
			t = time.Now()
			for range 1000 {
				if _, err := hello.Greet(c, "x"); err != nil {
					Log("ui: local Greet failed: %v", err)
					break
				}
			}
			Log("ui: 1000 in-process calls in %s", time.Since(t))
			t = time.Now()
			now, err := clock.Now(c)
			Log("ui: clock.Now -> %q err=%v in %s", now, err, time.Since(t))
			t = time.Now()
			for range 200 {
				if _, err := clock.Now(c); err != nil {
					Log("ui: remote Now failed: %v", err)
					break
				}
			}
			Log("ui: 200 cross-process calls in %s", time.Since(t))
			err = clock.Subscribe(c, 3, func(_ context.Context, tick string) error {
				Log("ui: callback from clock process: tick %s", tick)
				return nil
			})
			Log("ui: Subscribe returned err=%v", err)
			return nil
		})
		ctx.Effect(func(context.Context) error { Log("ui: cleanup ran"); return nil })
		Log("ui: applied")
		return nil
	},
})

// request is the existing CLI wire format: one JSON line.
type request struct {
	Argv []string `json:"argv"`
	TTY  bool     `json:"tty"`
	Cwd  string   `json:"cwd"`
}

// CLIPlugin listens on the CLI socket inside the UI runtime.
var CLIPlugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "cli",
	Inject: []string{"hello"},
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		var hello Hello
		if err := ctx.Use("hello", &hello); err != nil {
			return err
		}
		path := SocketPath()
		os.Remove(path)
		ln, err := net.Listen("unix", path)
		if err != nil {
			return err
		}
		ctx.Go(func(c context.Context) error {
			// Unloading cancels c and waits for this task, before the Effect
			// below runs: Accept has to be unblocked from here.
			go func() { <-c.Done(); ln.Close() }()
			for {
				conn, err := ln.Accept()
				if err != nil {
					if errors.Is(err, net.ErrClosed) {
						return nil
					}
					return err
				}
				go serveCLI(c, conn, hello)
			}
		})
		ctx.Effect(func(context.Context) error {
			Log("cli: cleanup ran, closing %s", path)
			ln.Close()
			return os.Remove(path)
		})
		Log("cli: listening on %s", path)
		return nil
	},
})

func serveCLI(ctx context.Context, conn net.Conn, hello Hello) {
	defer conn.Close()
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return
	}
	var req request
	if err := json.Unmarshal(line, &req); err != nil || len(req.Argv) == 0 {
		fmt.Fprintln(conn, "bad request")
		return
	}
	switch req.Argv[0] {
	case "version":
		fmt.Fprintln(conn, "attention p0-spike")
	case "greet":
		g, err := hello.Greet(ctx, "cli")
		if err != nil {
			fmt.Fprintln(conn, err)
			return
		}
		fmt.Fprintln(conn, g)
	default:
		fmt.Fprintf(conn, "unknown command: %s\n", req.Argv[0])
	}
}
