// Package actions is the actions plugin (RFC 0001 §5.7): it provides the
// "actions" service over actionsapi, so command users inject it and rutis
// orders them after it. It also registers the CLI's commands and command
// (apps/web/app/cli/registerCliCommands.ts).
package actions

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/clifmt"
)

// Info describes a command to another process.
type Info struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Keys  string `json:"keys"`
	CLI   bool   `json:"cli"`
}

// Service is the "actions" service.
type Service struct{}

// Run runs a CLI invocation.
func (Service) Run(ctx context.Context, argv []string, cwd string) (string, error) {
	return actionsapi.RunCLI(ctx, argv, cwd)
}

// List lists the commands.
func (Service) List(context.Context) ([]Info, error) {
	cmds := actionsapi.List()
	out := make([]Info, len(cmds))
	for i, c := range cmds {
		out[i] = Info{ID: c.ID, Title: c.Title, Keys: c.Keys, CLI: c.CLI}
	}
	return out, nil
}

// Remote is a command another process registers: a third party's plugin
// in any of rutis's languages (RFC 0001 §5.11).
type Remote struct {
	ID    string   `json:"id"`
	Title string   `json:"title"` // empty keeps it out of the palette
	Keys  string   `json:"keys"`
	CLI   bool     `json:"cli"`
	Flags []string `json:"flags"`
}

// RunFunc runs a remote command, in its process: the CLI's parameters
// (a bare flag's value is "true") and its working folder.
type RunFunc func(ctx context.Context, params map[string]string, cwd string) (string, error)

var (
	remoteMu sync.Mutex
	remote   = map[string]func(){} // the remote commands' offs, by ID
)

// Register adds cmd, which run runs, until Unregister or the actions
// plugin unloads; a second command with its ID replaces it.
func (Service) Register(_ context.Context, cmd Remote, run RunFunc) error {
	if cmd.ID == "" || run == nil {
		return fmt.Errorf("a command needs an id and a function to run")
	}
	off := actionsapi.Register(actionsapi.Command{ID: cmd.ID, Title: cmd.Title, Keys: cmd.Keys, CLI: cmd.CLI, Flags: cmd.Flags,
		Run: func(ctx context.Context, a actionsapi.Args) (string, error) {
			params := a.Params
			if params == nil {
				params = map[string]string{}
			}
			return run(ctx, params, a.Cwd)
		}})
	remoteMu.Lock()
	prev := remote[cmd.ID]
	remote[cmd.ID] = off
	remoteMu.Unlock()
	if prev != nil {
		prev()
	}
	return nil
}

// Unregister removes a command Register added.
func (Service) Unregister(_ context.Context, id string) error {
	remoteMu.Lock()
	off := remote[id]
	delete(remote, id)
	remoteMu.Unlock()
	if off != nil {
		off()
	}
	return nil
}

// dropRemote removes every remote command.
func dropRemote(context.Context) error {
	remoteMu.Lock()
	offs := remote
	remote = map[string]func(){}
	remoteMu.Unlock()
	for _, off := range offs {
		off()
	}
	return nil
}

// Plugin provides "actions" and the CLI's commands and command.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name: "actions",
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		ctx.Provide("actions", Service{})
		ctx.Effect(dropRemote)
		ctx.Effect(actionCleanup(actionsapi.Register(cliCommands())))
		ctx.Effect(actionCleanup(actionsapi.Register(cliCommand())))
		return nil
	},
})

func actionCleanup(off func()) func(context.Context) error {
	return func(context.Context) error { off(); return nil }
}

// cliCommands is `commands [filter=<prefix>]`: palette command IDs
// (a Title), filtered by ID prefix, sorted as the TS CLI's.
func cliCommands() actionsapi.Command {
	return actionsapi.Command{ID: "commands", CLI: true, Run: func(_ context.Context, a actionsapi.Args) (string, error) {
		filter := a.Params["filter"]
		var ids []string
		for _, c := range actionsapi.List() {
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

// cliCommand is `command id=<command-id>`: run a command by ID. The
// command's Run hops to the main thread itself when it needs to.
func cliCommand() actionsapi.Command {
	return actionsapi.Command{ID: "command", CLI: true, Run: func(ctx context.Context, a actionsapi.Args) (string, error) {
		id := a.Params["id"]
		if id == "" {
			return "", fmt.Errorf("Missing required parameter: id=<command-id>\nUsage: command id=<command-id>")
		}
		cmd, ok := actionsapi.Lookup(id)
		if !ok || cmd.Run == nil {
			return fmt.Sprintf("Command %q not found.", id), nil
		}
		if _, err := cmd.Run(ctx, actionsapi.Args{Params: map[string]string{}, Cwd: a.Cwd}); err != nil {
			return "", err
		}
		return "Executed " + id, nil
	}}
}
