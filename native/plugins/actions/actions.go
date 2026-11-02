// Package actions is the command registry and actions service plugin
// (RFC 0001 §5.7, §5.9).
package actions

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/internal/clifmt"
)

// Plugin provides "actions" and registers the CLI's commands and command.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name: "actions",
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		svc := New()
		ctx.Provide("actions", svc)
		ctx.Effect(svc.dropRemote)
		ctx.Effect(actionCleanup(svc.Add(svc.cliCommands())))
		ctx.Effect(actionCleanup(svc.Add(svc.cliCommand())))
		return nil
	},
})

// Info describes a command to another process.
type Info struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Keys  string `json:"keys"`
	CLI   bool   `json:"cli"`
}

// Remote is a command another process registers (RFC 0001 §5.11).
type Remote struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Keys  string   `json:"keys"`
	CLI   bool     `json:"cli"`
	Flags []string `json:"flags"`
}

// RunFunc runs a remote command in its process.
type RunFunc func(ctx context.Context, params map[string]string, cwd string) (string, error)

// Command is one action.
type Command struct {
	ID    string
	Title string
	Keys  string
	CLI   bool
	Flags []string
	Run   func(ctx context.Context, args Args) (string, error)
	Main  func()
}

type entry struct {
	cmd Command
	seq int
}

// Args are a CLI invocation's parameters.
type Args struct {
	Params map[string]string
	Cwd    string
}

// ParseArgs reads CLI tokens after the command name.
func ParseArgs(tokens []string, cwd string) Args {
	a := Args{Params: map[string]string{}, Cwd: cwd}
	for _, t := range tokens {
		if k, v, ok := strings.Cut(t, "="); ok {
			a.Params[k] = v
		} else {
			a.Params[t] = "true"
		}
	}
	return a
}

// Has reports whether a parameter was given.
func (a Args) Has(key string) bool { _, ok := a.Params[key]; return ok }

// Int reads a parameter as a positive integer.
func (a Args) Int(key string) (int, bool, error) {
	v, ok := a.Params[key]
	if !ok {
		return 0, false, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return 0, true, fmt.Errorf("Invalid %s: %s", key, v)
	}
	return n, true, nil
}

// Service is the "actions" service and command registry.
type Service struct {
	mu         sync.Mutex
	commands   map[string]*entry
	seq        int
	remote     map[string]func()
	activeFile func(context.Context) (string, error)
	openPath   func(ctx context.Context, path string, newTab bool) error
}

// New creates an empty command registry and actions service.
func New() *Service {
	return &Service{
		commands: map[string]*entry{},
		remote:   map[string]func(){},
	}
}

// Run runs a CLI invocation over the wire.
func (s *Service) Run(ctx context.Context, argv []string, cwd string) (string, error) {
	return s.RunCLI(ctx, argv, cwd)
}

// List lists the registered commands over the wire.
func (s *Service) List(context.Context) ([]Info, error) {
	cmds := s.Commands()
	out := make([]Info, len(cmds))
	for i, c := range cmds {
		out[i] = Info{ID: c.ID, Title: c.Title, Keys: c.Keys, CLI: c.CLI}
	}
	return out, nil
}

// Register adds a remote command until Unregister or the plugin unloads.
func (s *Service) Register(_ context.Context, cmd Remote, run RunFunc) error {
	if cmd.ID == "" || run == nil {
		return fmt.Errorf("a command needs an id and a function to run")
	}
	off := s.Add(Command{ID: cmd.ID, Title: cmd.Title, Keys: cmd.Keys, CLI: cmd.CLI, Flags: cmd.Flags,
		Run: func(ctx context.Context, a Args) (string, error) {
			params := a.Params
			if params == nil {
				params = map[string]string{}
			}
			return run(ctx, params, a.Cwd)
		}})
	s.mu.Lock()
	prev := s.remote[cmd.ID]
	s.remote[cmd.ID] = off
	s.mu.Unlock()
	if prev != nil {
		prev()
	}
	return nil
}

// Unregister removes a command Register added.
func (s *Service) Unregister(_ context.Context, id string) error {
	s.mu.Lock()
	off := s.remote[id]
	delete(s.remote, id)
	s.mu.Unlock()
	if off != nil {
		off()
	}
	return nil
}

// Add registers an in-process command; off removes it.
func (s *Service) Add(cmd Command) (off func()) {
	if s == nil {
		return func() {}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	e := &entry{cmd: cmd, seq: s.seq}
	s.commands[cmd.ID] = e
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.commands[cmd.ID] == e {
			delete(s.commands, cmd.ID)
		}
	}
}

// Lookup returns a command by ID, or nil when not registered.
func (s *Service) Lookup(id string) *Command {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.commands[id]
	if !ok {
		return nil
	}
	cp := e.cmd
	return &cp
}

// Commands returns the registered commands by title, then ID.
func (s *Service) Commands() []Command {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Command, 0, len(s.commands))
	for _, e := range s.commands {
		out = append(out, e.cmd)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Title != out[j].Title {
			return out[i].Title < out[j].Title
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// RunCLI runs a CLI invocation: argv[0] is the command, the rest its parameters.
func (s *Service) RunCLI(ctx context.Context, argv []string, cwd string) (string, error) {
	if len(argv) == 0 || argv[0] == "help" || argv[0] == "--help" {
		return s.Help(), nil
	}
	cmd := s.Lookup(argv[0])
	if cmd == nil || !cmd.CLI {
		if i := strings.LastIndexByte(argv[0], ':'); i > 0 {
			if parent := s.Lookup(argv[0][:i]); parent != nil && parent.CLI && slices.Contains(parent.Flags, argv[0][i+1:]) {
				args := append([]string{argv[0][i+1:]}, argv[1:]...)
				return parent.Run(ctx, ParseArgs(args, cwd))
			}
		}
	}
	if cmd == nil || !cmd.CLI {
		msg := fmt.Sprintf("Command %q not found.", argv[0])
		if sug := s.suggest(argv[0]); len(sug) > 0 {
			msg += " Did you mean: " + strings.Join(sug, ", ") + "?"
		} else {
			msg += " It may require a plugin to be enabled."
		}
		return "", fmt.Errorf("%s", msg)
	}
	return cmd.Run(ctx, ParseArgs(argv[1:], cwd))
}

// Help lists the CLI commands.
func (s *Service) Help() string {
	return "Usage: attention <command> [key=value ...]\n\nCommands:\n  " + strings.Join(s.cliIDs(), "\n  ")
}

// SetActiveFile installs the workspace callback that resolves the active file path.
func (s *Service) SetActiveFile(fn func(context.Context) (string, error)) (off func()) {
	if s == nil {
		return func() {}
	}
	s.mu.Lock()
	s.activeFile = fn
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		s.activeFile = nil
		s.mu.Unlock()
	}
}

// ActiveFile returns the active file path from the workspace, or an error if headless.
func (s *Service) ActiveFile(ctx context.Context) (string, error) {
	if s == nil {
		return "", errors.New("the window is closed")
	}
	s.mu.Lock()
	fn := s.activeFile
	s.mu.Unlock()
	if fn == nil {
		return "", errors.New("the window is closed")
	}
	return fn(ctx)
}

// SetOpenPath installs the workspace callback that opens a file path in a tab.
func (s *Service) SetOpenPath(fn func(ctx context.Context, path string, newTab bool) error) (off func()) {
	if s == nil {
		return func() {}
	}
	s.mu.Lock()
	s.openPath = fn
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		s.openPath = nil
		s.mu.Unlock()
	}
}

// OpenPath opens path in the workspace if a window is running.
func (s *Service) OpenPath(ctx context.Context, path string, newTab bool) error {
	if s == nil {
		return errors.New("the window is closed")
	}
	s.mu.Lock()
	fn := s.openPath
	s.mu.Unlock()
	if fn == nil {
		return errors.New("the window is closed")
	}
	return fn(ctx, path, newTab)
}

func (s *Service) dropRemote(context.Context) error {
	s.mu.Lock()
	offs := s.remote
	s.remote = map[string]func(){}
	s.mu.Unlock()
	for _, off := range offs {
		off()
	}
	return nil
}

func (s *Service) cliCommands() Command {
	return Command{ID: "commands", CLI: true, Run: func(_ context.Context, a Args) (string, error) {
		filter := a.Params["filter"]
		var ids []string
		for _, c := range s.Commands() {
			if c.Title == "" {
				continue
			}
			if filter != "" && !strings.HasPrefix(c.ID, filter) {
				continue
			}
			ids = append(ids, c.ID)
		}
		clifmt.Sort(ids)
		return strings.Join(ids, "\n"), nil
	}}
}

func (s *Service) cliCommand() Command {
	return Command{ID: "command", CLI: true, Run: func(ctx context.Context, a Args) (string, error) {
		id := a.Params["id"]
		if id == "" {
			return "", fmt.Errorf("Missing required parameter: id=<command-id>\nUsage: command id=<command-id>")
		}
		cmd := s.Lookup(id)
		if cmd == nil || cmd.Run == nil {
			return fmt.Sprintf("Command %q not found.", id), nil
		}
		if _, err := cmd.Run(ctx, Args{Params: map[string]string{}, Cwd: a.Cwd}); err != nil {
			return "", err
		}
		return "Executed " + id, nil
	}}
}

func (s *Service) cliIDs() []string {
	var ids []string
	for _, c := range s.Commands() {
		if c.CLI {
			ids = append(ids, c.ID)
		}
	}
	sort.Strings(ids)
	return ids
}

func (s *Service) suggest(name string) []string {
	var prefix, sub, near []string
	for _, id := range s.cliIDs() {
		switch {
		case strings.HasPrefix(id, name):
			prefix = append(prefix, id)
		case strings.Contains(id, name) || (len(name) > 2 && strings.Contains(name, id)):
			sub = append(sub, id)
		case distance(name, id) <= 2:
			near = append(near, id)
		}
	}
	out := append(append(prefix, sub...), near...)
	if len(out) > 3 {
		out = out[:3]
	}
	return out
}

func actionCleanup(off func()) func(context.Context) error {
	return func(context.Context) error { off(); return nil }
}

func distance(a, b string) int {
	prev := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur := make([]int, len(b)+1)
		cur[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(b)]
}
