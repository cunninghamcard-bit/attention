// Package actions is the actions plugin (RFC 0001 §5.7): it provides the
// "actions" service over actionsapi, so command users inject it and rutis
// orders them after it.
package actions

import (
	"context"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
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

// Plugin provides "actions".
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name: "actions",
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		ctx.Provide("actions", Service{})
		return nil
	},
})
