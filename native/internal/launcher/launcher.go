// Package launcher is attention's launcher mode (RFC 0001 §5.3): it holds
// the single-instance lock, writes the run's rutis.json and runs rutis-host
// as its child, or, when an instance is already running, acts as the CLI
// client over the existing {argv, tty, cwd} socket.
package launcher

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
)

// Options are the launcher's parsed arguments.
type Options struct {
	Mounts  []string // absolute directories to open
	Profile string   // "desktop" (default) or "headless"
	Command []string // a CLI command for the running instance
}

// Parse reads `attention [--profile p] [--mount dir]... [dir]... [command args...]`.
// A positional argument that is an existing directory is a mount; the first
// one that is not starts the CLI command, which takes the rest verbatim.
func Parse(args []string) (Options, error) {
	o := Options{Profile: "desktop"}
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--profile" || a == "--mount":
			if i+1 >= len(args) {
				return o, fmt.Errorf("%s needs a value", a)
			}
			i++
			if err := o.set(a, args[i]); err != nil {
				return o, err
			}
		case strings.HasPrefix(a, "--profile=") || strings.HasPrefix(a, "--mount="):
			name, value, _ := strings.Cut(a, "=")
			if err := o.set(name, value); err != nil {
				return o, err
			}
		case strings.HasPrefix(a, "-"):
			return o, fmt.Errorf("unknown flag %s", a)
		default:
			if st, err := os.Stat(a); err == nil && st.IsDir() {
				if err := o.set("--mount", a); err != nil {
					return o, err
				}
				continue
			}
			o.Command = append([]string(nil), args[i:]...)
			return o, nil
		}
	}
	return o, nil
}

func (o *Options) set(flag, value string) error {
	switch flag {
	case "--profile":
		if value != "desktop" && value != "headless" {
			return fmt.Errorf("unknown profile %q (desktop or headless)", value)
		}
		o.Profile = value
	case "--mount":
		abs, err := filepath.Abs(value)
		if err != nil {
			return err
		}
		st, err := os.Stat(abs)
		if err != nil {
			return err
		}
		if !st.IsDir() {
			return fmt.Errorf("--mount %s is not a directory", value)
		}
		o.Mounts = append(o.Mounts, abs)
	}
	return nil
}

// Run is the launcher; it returns the process's exit code.
func Run(args []string) int {
	opts, err := Parse(args)
	if err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
		return 2
	}
	lock, err := acquire(paths.LockPath())
	if err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
		return 1
	}
	if lock == nil {
		return client(opts)
	}
	defer lock.Close()
	if len(opts.Command) > 0 {
		fmt.Fprintln(os.Stderr, "Error: attention is not running.")
		return 1
	}
	return runHost(opts)
}

// acquire takes the single-instance lock without blocking: nil, nil when
// another launcher holds it. The descriptor is close-on-exec, so only this
// process holds it, for as long as it runs.
func acquire(path string) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, nil
		}
		return nil, err
	}
	return f, nil
}

// client sends one request per mount and the command (or "focus") to the
// running instance. The socket may not be listening yet when that instance
// is still starting, so it retries for a few seconds.
func client(opts Options) int {
	var requests [][]string
	for _, m := range opts.Mounts {
		requests = append(requests, []string{"mount", "path=" + m})
	}
	if len(opts.Command) > 0 {
		requests = append(requests, opts.Command)
	} else if len(requests) == 0 {
		requests = append(requests, []string{"focus"})
	}
	for _, argv := range requests {
		if err := send(argv, os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, "Error:", err)
			return 1
		}
	}
	return 0
}

func send(argv []string, out io.Writer) error {
	var conn net.Conn
	var err error
	for deadline := time.Now().Add(5 * time.Second); ; {
		conn, err = net.Dial("unix", paths.SocketPath())
		if err == nil || time.Now().After(deadline) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		return fmt.Errorf("attention is starting but its CLI is not reachable: %w", err)
	}
	defer conn.Close()
	cwd, _ := os.Getwd()
	tty := false
	if st, err := os.Stdin.Stat(); err == nil {
		tty = st.Mode()&os.ModeCharDevice != 0
	}
	line, err := json.Marshal(map[string]any{"argv": argv, "tty": tty, "cwd": cwd})
	if err != nil {
		return err
	}
	if _, err := conn.Write(append(line, '\n')); err != nil {
		return err
	}
	_, err = io.Copy(out, conn)
	return err
}

// Rows returns the plugin rows of a profile (RFC 0001 §5.10).
func Rows(profile string, mounts []string) []map[string]any {
	project := map[string]any{"id": "project", "name": "go:project"}
	if len(mounts) > 0 {
		project["config"] = map[string]any{"mounts": mounts}
	}
	base := []map[string]any{
		{"id": "actions", "name": "go:actions"},
		{"id": "cli", "name": "go:cli"},
		{"id": "fs", "name": "go:fs"},
		project,
	}
	if profile == "headless" {
		return base
	}
	return append([]map[string]any{{"id": "shell", "name": "go:shell"}}, append(base,
		map[string]any{"id": "workspace", "name": "go:workspace"})...)
}

// Config is the rutis.json for a run.
func Config(self string, profile string, mounts []string) map[string]any {
	return map[string]any{
		"format": 1,
		"id":     "attention",
		"runtimes": map[string]any{
			"go": map[string]any{"binaries": []string{self}, "start": "eager", "restart": "on-failure"},
		},
		"rows": Rows(profile, mounts),
	}
}

func hostBinary(self string) (string, error) {
	if h := os.Getenv("RUTIS_HOST"); h != "" {
		return h, nil
	}
	beside := filepath.Join(filepath.Dir(self), "rutis-host")
	if st, err := os.Stat(beside); err == nil && !st.IsDir() {
		return beside, nil
	}
	return exec.LookPath("rutis-host")
}

func runHost(opts Options) int {
	self, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
		return 1
	}
	if resolved, err := filepath.EvalSymlinks(self); err == nil {
		self = resolved
	}
	host, err := hostBinary(self)
	if err != nil {
		fmt.Fprintln(os.Stderr, "attention: rutis-host not found (set RUTIS_HOST or put it beside attention):", err)
		return 1
	}
	// One directory per instance, beside its socket: the lock is held, so
	// whatever is there was left by a launcher that was killed.
	dir := paths.SocketPath() + ".host"
	os.RemoveAll(dir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
		return 1
	}
	defer os.RemoveAll(dir)
	data, err := json.MarshalIndent(Config(self, opts.Profile, opts.Mounts), "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
		return 1
	}
	cfg := filepath.Join(dir, "rutis.json")
	if err := os.WriteFile(cfg, data, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
		return 1
	}

	cmd := exec.Command(host, "run", cfg)
	// The UI runtime watches the launcher and stops the app when it is gone
	// (Pdeathsig cannot do it: Go delivers it twice, and a second signal
	// makes rutis-host skip the cleanups).
	cmd.Env = append(os.Environ(), "ATTENTION_PROFILE="+opts.Profile, "ATTENTION_LAUNCHER_PID="+strconv.Itoa(os.Getpid()))
	// rutis-host gets a process group of its own, so a terminal's Ctrl-C
	// reaches only the launcher, which turns it into one SIGTERM (a second
	// signal would make the host skip cleanups).
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// rutis-host writes to a file, not to a pipe of ours: if the launcher
	// dies, a pipe would break, and the host's next status line would fail
	// half way through stopping. The launcher follows the file instead.
	logPath := filepath.Join(dir, "host.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
		return 1
	}
	cmd.Stdout, cmd.Stderr = logFile, logFile
	// Handle (not ignore) the signals: an ignored signal stays ignored in
	// the child, and rutis-host must keep its own Ctrl-C handling.
	sigs := make(chan os.Signal, 4)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	defer signal.Stop(sigs)
	err = cmd.Start()
	logFile.Close() // the host holds its own descriptor
	if err != nil {
		fmt.Fprintln(os.Stderr, "attention:", err)
		return 1
	}

	gaveUp := make(chan struct{}, 1)
	waited := make(chan error, 1)
	go func() { waited <- cmd.Wait() }()
	exited := make(chan error, 1)
	go func() {
		err := follow(logPath, waited, func(line string) {
			fmt.Fprintln(os.Stderr, line)
			// rutis-host: "runtime go-attention: gave up after 5 restarts …"
			if strings.Contains(line, "runtime go-attention: gave up") {
				select {
				case gaveUp <- struct{}{}:
				default:
				}
			}
		})
		exited <- err
	}()

	failed, forwarded := false, false
	for {
		select {
		case <-sigs:
			// Ctrl-C, SIGTERM or SIGHUP: stop the host once. A second Ctrl-C
			// is the user insisting, and is forwarded too.
			if !forwarded {
				forwarded = true
				cmd.Process.Signal(syscall.SIGTERM)
			} else {
				cmd.Process.Signal(syscall.SIGINT)
			}
		case <-gaveUp:
			failed = true
			fmt.Fprintln(os.Stderr, "attention: the window process keeps crashing; stopping")
			cmd.Process.Signal(syscall.SIGTERM)
		case err := <-exited:
			code := 0
			var exit *exec.ExitError
			if errors.As(err, &exit) {
				code = exit.ExitCode()
				if code < 0 { // ended by a signal
					code = 1
				}
			} else if err != nil {
				fmt.Fprintln(os.Stderr, "attention:", err)
				code = 1
			}
			if failed && code == 0 {
				code = 1
			}
			return code
		}
	}
}

// follow reads the lines appended to path until done yields, then reads
// what is left, and returns done's value.
func follow(path string, done <-chan error, line func(string)) error {
	f, err := os.Open(path)
	if err != nil {
		return <-done
	}
	defer f.Close()
	r := bufio.NewReaderSize(f, 64*1024)
	var partial string
	drain := func() {
		for {
			chunk, err := r.ReadString('\n')
			partial += chunk
			if err != nil {
				return // EOF: wait for more
			}
			line(strings.TrimRight(partial, "\r\n"))
			partial = ""
		}
	}
	tick := time.NewTicker(50 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case err := <-done:
			drain()
			if partial != "" {
				line(partial)
			}
			return err
		case <-tick.C:
			drain()
		}
	}
}
