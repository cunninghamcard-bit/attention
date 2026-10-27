// Package actions is the actions plugin (RFC 0001 §5.7): it provides the
// "actions" service over actionsapi, so command users inject it and rutis
// orders them after it. It also registers the CLI's commands and command
// (apps/web/app/cli/registerCliCommands.ts).
package actions

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/natural"
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

// Plugin provides "actions" and the CLI's commands and command.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name: "actions",
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		ctx.Provide("actions", Service{})
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
		sort.Slice(ids, func(i, j int) bool { return natural.Less(ids[i], ids[j]) })
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
