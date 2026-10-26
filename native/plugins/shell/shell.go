// Package shell is the shell plugin (RFC 0001 §5.7): the window. mygo's
// App.Run is the carrier and stays in main; opening and closing the window
// is this plugin's, so a profile without it is headless.
package shell

import (
	"context"
	"sync/atomic"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

// Shell is the "shell" service. Its only method exists so the service has a
// shape; UI plugins inject it for ordering and use shellapi in-process.
type Shell struct{}

// Ready reports that the window is up.
func (Shell) Ready(context.Context) (bool, error) { return shellapi.Window() != nil, nil }

// Plugin opens the window when it loads and closes it when it unloads. The
// user closing the window quits the app (the UI runtime then asks
// rutis-host to stop); the plugin unloading does not.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name: "shell",
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		var unloading atomic.Bool
		w := mygo.NewWindow(mygo.WindowOptions{
			Title:   "attention",
			Width:   1280,
			Height:  820,
			Content: ui.View(shellapi.View),
		})
		w.OnClosed(func() {
			if !unloading.Load() {
				mygo.App.Quit()
			}
		})
		shellapi.SetWindow(w)
		ctx.Provide("shell", Shell{})
		ctx.Effect(func(context.Context) error {
			unloading.Store(true)
			shellapi.SetWindow(nil)
			w.Destroy()
			return nil
		})
		return nil
	},
})
