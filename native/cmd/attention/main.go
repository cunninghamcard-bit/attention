// Command attention is the P0 topology spike's binary. It has two modes
// (RFC 0001 §5.3):
//
//   - launcher (run by the user): if an instance is running, act as the CLI
//     client; otherwise write a rutis.json and exec rutis-host, which then
//     starts this same binary as a Go runtime over fd:.
//   - UI runtime (started by rutis-host): mygo on the main thread, rutis on a
//     goroutine.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/spike"
)

func main() {
	args := os.Args[1:]
	if isRuntime(args) {
		runtimeMain(args)
		return
	}
	launcher(args)
}

func isRuntime(args []string) bool {
	if len(args) == 0 {
		return false
	}
	a := args[0]
	return a == "--rutis-manifest" || strings.HasPrefix(a, "fd:") || strings.HasPrefix(a, "unix:") || strings.HasPrefix(a, "tcp:")
}

var defs = []*rutis.Definition{spike.HelloPlugin, spike.UIPlugin, spike.CLIPlugin}

func runtimeMain(args []string) {
	if args[0] == "--rutis-manifest" {
		if err := rutis.ServeArgs(args, defs...); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	// stderr is a pipe to rutis-host. If the host dies, rutis unloads this
	// runtime's rows by itself; a cleanup that logs must not be killed by
	// SIGPIPE half way, so a write to the broken pipe returns EPIPE instead.
	signal.Ignore(syscall.SIGPIPE)
	spike.Log("runtime: started with %q, parent pid %d", args, os.Getppid())
	ended := make(chan error, 1)
	go func() {
		err := rutis.ServeArgs(args, defs...)
		spike.Log("runtime: rutis session ended, err=%v", err)
		ended <- err
		mygo.App.Quit()
	}()
	mygo.App.WhenReady(func() {
		w := mygo.NewWindow(mygo.WindowOptions{Title: "attention P0 spike", Width: 900, Height: 600, Content: ui.View(spike.View)})
		spike.SetWindow(w)
		spike.Log("runtime: window open")
		// SPIKE_AUTOQUIT=<seconds> stands in for the user closing the app.
		if d, err := time.ParseDuration(os.Getenv("SPIKE_AUTOQUIT") + "s"); err == nil && d > 0 {
			time.AfterFunc(d, func() { spike.Log("runtime: autoquit"); mygo.App.Quit() })
		}
	})
	if err := mygo.App.Run(); err != nil {
		spike.Log("runtime: App.Run error: %v", err)
	}
	spike.Log("runtime: App.Run returned")
	select {
	case <-ended:
		// The host ended the session (it is stopping): nothing more to do.
	default:
		// The user closed the window. SPIKE_SHUTDOWN picks how the host learns.
		if os.Getenv("SPIKE_SHUTDOWN") == "sigterm-parent" {
			spike.Log("runtime: sending SIGTERM to rutis-host (pid %d)", os.Getppid())
			syscall.Kill(os.Getppid(), syscall.SIGTERM)
			select {
			case <-ended:
			case <-time.After(15 * time.Second):
				spike.Log("runtime: session did not end within 15s")
			}
		}
	}
	spike.Log("runtime: exiting")
	os.Exit(0)
}

func launcher(args []string) {
	if conn, err := net.Dial("unix", spike.SocketPath()); err == nil {
		client(conn, args)
		return
	}
	self, err := os.Executable()
	must(err)
	clock := filepath.Join(filepath.Dir(self), "clock")
	dir, err := os.MkdirTemp("", "attention-host-")
	must(err)
	restart := os.Getenv("SPIKE_RESTART")
	if restart == "" {
		restart = "no"
	}
	config := map[string]any{
		"format": 1,
		"id":     "attention",
		"runtimes": map[string]any{
			"go": map[string]any{"binaries": []string{self, clock}, "start": "eager", "restart": restart},
		},
		"rows": []map[string]any{
			{"id": "hello", "name": "go:hello"},
			{"id": "clock", "name": "go:clock"},
			{"id": "ui", "name": "go:ui"},
			{"id": "cli", "name": "go:cli"},
		},
	}
	data, err := json.MarshalIndent(config, "", "  ")
	must(err)
	path := filepath.Join(dir, "rutis.json")
	must(os.WriteFile(path, data, 0o644))
	host := os.Getenv("RUTIS_HOST")
	if host == "" {
		host, err = exec.LookPath("rutis-host")
		must(err)
	}
	fmt.Fprintf(os.Stderr, "launcher: exec %s run %s\n", host, path)
	must(syscall.Exec(host, []string{host, "run", path}, os.Environ()))
}

func client(conn net.Conn, args []string) {
	defer conn.Close()
	cwd, _ := os.Getwd()
	line, err := json.Marshal(map[string]any{"argv": args, "tty": false, "cwd": cwd})
	must(err)
	_, err = conn.Write(append(line, '\n'))
	must(err)
	io.Copy(os.Stdout, conn)
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
		os.Exit(1)
	}
}
