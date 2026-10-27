// Command attention is the reader. One binary, three modes (RFC 0001 §5.3):
//
//   - `--rutis-manifest`: rutis-host asks what plugins it holds;
//   - a rutis channel (fd:, unix:, tcp:): the UI runtime, started by
//     rutis-host — mygo on the main thread, the plugins on goroutines;
//   - anything else: the launcher.
package main

import (
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"

	"github.com/cunninghamcard-bit/attention/native/internal/launcher"
	"github.com/cunninghamcard-bit/attention/native/internal/lifecycle"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/cli"
	"github.com/cunninghamcard-bit/attention/native/plugins/commandpalette"
	"github.com/cunninghamcard-bit/attention/native/plugins/fileresource"
	"github.com/cunninghamcard-bit/attention/native/plugins/filetree"
	"github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/gotoline"
	"github.com/cunninghamcard-bit/attention/native/plugins/imageui"
	"github.com/cunninghamcard-bit/attention/native/plugins/layout"
	"github.com/cunninghamcard-bit/attention/native/plugins/markdownui"
	"github.com/cunninghamcard-bit/attention/native/plugins/palette"
	"github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/search"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/shortcuts"
	"github.com/cunninghamcard-bit/attention/native/plugins/switcher"
	"github.com/cunninghamcard-bit/attention/native/plugins/textui"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
)

// plugins are every plugin this binary carries; the profile's rows pick
// which run.
var plugins = []*rutis.Definition{
	shell.Plugin, actions.Plugin, cli.Plugin, fs.Plugin, project.Plugin, fileresource.Plugin, layout.Plugin, workspace.Plugin,
	shortcuts.Plugin, palette.Plugin, switcher.Plugin, commandpalette.Plugin, gotoline.Plugin, settings.Plugin,
	filetree.Plugin, search.Plugin, textui.Plugin, markdownui.Plugin, imageui.Plugin,
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
		// A signal to this process asks rutis-host to stop, as the window's
		// quit does, so every plugin unloads instead of the process dying.
		var once sync.Once
		stop := func() { once.Do(func() { syscall.Kill(os.Getppid(), syscall.SIGTERM) }) }
		sigs := make(chan os.Signal, 2)
		signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
		go func() {
			<-sigs
			stop()
			<-sigs // a second signal: the user insists
			os.Exit(1)
		}()
		go watchLauncher(stop)
		lifecycle.SetQuit(stop)
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
	// Every quit — the window's close button, the quit command, Ctrl Q, a
	// signal mygo turns into a quit — first asks rutis-host (our parent) to
	// stop. The host unloads every plugin while the run loop still runs, so
	// cleanups can post to the main thread; when the session has ended the
	// quit goes through.
	var sessionOver, signalled atomic.Bool
	mygo.App.OnBeforeQuit(func(e *mygo.QuitEvent) {
		if sessionOver.Load() {
			return
		}
		if signalled.CompareAndSwap(false, true) {
			debugf("runtime: quit requested, signalling rutis-host")
			if err := syscall.Kill(os.Getppid(), syscall.SIGTERM); err != nil {
				// No host to stop the session: let the quit through.
				fmt.Fprintln(os.Stderr, "attention: cannot signal rutis-host:", err)
				sessionOver.Store(true)
				return
			}
		}
		e.PreventDefault()
	})
	ended := make(chan error, 1)
	go func() {
		err := rutis.ServeArgs(args, plugins...)
		ended <- err
		sessionOver.Store(true)
		mygo.App.Quit()
	}()
	go watchLauncher(mygo.App.Quit)
	// Every quit goes through mygo's, which asks rutis-host first.
	lifecycle.SetQuit(func() { mygo.App.Quit() })
	if err := mygo.App.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
	}
	// App.Run returns only after the session ended (or the native loop
	// died on its own, when the host is still to be told).
	select {
	case err := <-ended:
		if err != nil {
			fmt.Fprintln(os.Stderr, "attention:", err)
			return 1
		}
		return 0
	default:
	}
	if signalled.CompareAndSwap(false, true) {
		syscall.Kill(os.Getppid(), syscall.SIGTERM)
	}
	select {
	case <-ended:
	case <-time.After(15 * time.Second):
		fmt.Fprintln(os.Stderr, "attention: rutis-host did not stop within 15s")
	}
	return 0
}

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}

// watchLauncher calls stop once the launcher (ATTENTION_LAUNCHER_PID) is
// gone: it holds the single-instance lock, so without it another instance
// could start beside this one.
func watchLauncher(stop func()) {
	pid, err := strconv.Atoi(os.Getenv("ATTENTION_LAUNCHER_PID"))
	if err != nil || pid <= 1 {
		return
	}
	// A PID can be reused: the launcher is the process with this PID and
	// the start time it had when we began.
	started := startTime(pid)
	for {
		time.Sleep(500 * time.Millisecond)
		gone := errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) || startTime(pid) != started
		if gone {
			debugf("runtime: the launcher is gone, stopping")
			stop()
			return
		}
	}
}

// startTime is the start time of a process, from /proc/<pid>/stat (field 22),
// or "" where there is no /proc.
func startTime(pid int) string {
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return ""
	}
	// The command name (field 2) may hold spaces; fields count from after it.
	s := string(data)
	if i := strings.LastIndexByte(s, ')'); i >= 0 {
		s = s[i+1:]
	}
	fields := strings.Fields(s)
	if len(fields) < 20 {
		return ""
	}
	return fields[19]
}
