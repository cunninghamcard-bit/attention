// Package actionsapi is the in-process command registry behind the actions
// plugin (RFC 0001 §5.9): every command is one entry here, reachable from
// the command palette, a shortcut and the CLI alike. Plugins register in
// Apply and hand the returned off to Effect.
//
// TODO(RFC §5.9): commands of out-of-process plugins register through the
// actions service; only in-process registration exists yet.
package actionsapi

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// Args are a CLI invocation's parameters: key=value, and a bare token as
// "true", as the existing CLI parses them.
type Args struct {
	Params map[string]string
	Cwd    string
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

// Command is one action.
type Command struct {
	ID    string // also the CLI command name
	Title string // shown in the palette; empty keeps it out of the palette
	Keys  string // shortcut hint shown in the palette, as "Ctrl+P"
	// CLI makes the command reachable from the CLI.
	CLI bool
	Run func(ctx context.Context, args Args) (string, error)
}

var (
	mu       sync.Mutex
	commands = map[string]*entry{}
	seq      int
)

type entry struct {
	cmd Command
	seq int
}

// Register adds a command; off removes it. A second command with the same
// ID replaces the first until either is removed.
func Register(cmd Command) (off func()) {
	mu.Lock()
	defer mu.Unlock()
	seq++
	e := &entry{cmd: cmd, seq: seq}
	commands[cmd.ID] = e
	return func() {
		mu.Lock()
		defer mu.Unlock()
		if commands[cmd.ID] == e {
			delete(commands, cmd.ID)
		}
	}
}

// List returns the commands by title, then ID.
func List() []Command {
	mu.Lock()
	defer mu.Unlock()
	out := make([]Command, 0, len(commands))
	for _, e := range commands {
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

// Lookup returns a command by ID.
func Lookup(id string) (Command, bool) {
	mu.Lock()
	defer mu.Unlock()
	e, ok := commands[id]
	if !ok {
		return Command{}, false
	}
	return e.cmd, true
}

// RunCLI runs a CLI invocation: argv[0] is the command, the rest its
// parameters.
func RunCLI(ctx context.Context, argv []string, cwd string) (string, error) {
	if len(argv) == 0 {
		return "", fmt.Errorf("No command given.")
	}
	cmd, ok := Lookup(argv[0])
	if !ok || !cmd.CLI {
		return "", fmt.Errorf("Command %q not found.", argv[0])
	}
	return cmd.Run(ctx, ParseArgs(argv[1:], cwd))
}
