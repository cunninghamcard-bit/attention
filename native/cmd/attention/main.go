// Command attention is the reader. One binary, three modes (RFC 0001 §5.3):
//
//   - `--rutis-manifest`: rutis-host asks what plugins it holds;
//   - a rutis channel (fd:, unix:, tcp:): the UI runtime, started by
//     rutis-host — mygo on the main thread, the plugins on goroutines;
//   - anything else: the launcher.
package main

import (
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"

	"github.com/cunninghamcard-bit/attention/native/internal/launcher"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/cli"
	"github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
)

// plugins are every plugin this binary carries; the profile's rows pick
// which run.
var plugins = []*rutis.Definition{
	shell.Plugin, actions.Plugin, cli.Plugin, fs.Plugin, project.Plugin, workspace.Plugin,
}

func main() {
	args := os.Args[1:]
	switch {
	case len(args) == 1 && args[0] == "--rutis-manifest":
		if err := rutis.ServeArgs(args, plugins...); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case len(args) > 0 && isChannel(args[0]):
		os.Exit(runtimeMain(args))
	default:
		os.Exit(launcher.Run(args))
	}
}

func isChannel(a string) bool {
	return strings.HasPrefix(a, "fd:") || strings.HasPrefix(a, "unix:") || strings.HasPrefix(a, "tcp:")
}

// runtimeMain is the UI runtime. It is the carrier: mygo's run loop owns
// the main thread; the window itself belongs to the shell plugin.
func runtimeMain(args []string) int {
	// stdout and stderr are pipes to rutis-host. If it dies, rutis unloads
	// this runtime's rows by itself; a cleanup that logs must not die of
	// SIGPIPE half way (spike finding 4).
	signal.Ignore(syscall.SIGPIPE)

	if os.Getenv("ATTENTION_PROFILE") == "headless" {
		if err := rutis.ServeArgs(args, plugins...); err != nil {
			fmt.Fprintln(os.Stderr, "attention:", err)
			return 1
		}
		return 0
	}

	mygo.App.SetName("attention")
	// Closing the last window must not quit by itself: the shell plugin
	// quits when the user closes it, not when it is unloaded and reloaded.
	mygo.App.OnWindowAllClosed(func() {})
	ended := make(chan error, 1)
	go func() {
		err := rutis.ServeArgs(args, plugins...)
		ended <- err
		// The host stopped the session: leave the run loop.
		mygo.App.Quit()
	}()
	if err := mygo.App.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
	}
	select {
	case err := <-ended:
		if err != nil {
			fmt.Fprintln(os.Stderr, "attention:", err)
			return 1
		}
		return 0
	default:
	}
	// The user closed the window: ask rutis-host (our parent) to stop, which
	// unloads every plugin, ours included, then ends this session.
	syscall.Kill(os.Getppid(), syscall.SIGTERM)
	select {
	case <-ended:
	case <-time.After(15 * time.Second):
		fmt.Fprintln(os.Stderr, "attention: rutis-host did not stop within 15s")
	}
	return 0
}
