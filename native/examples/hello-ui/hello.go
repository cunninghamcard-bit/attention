// Package hello is a third party's UI plugin for attention, compiled in
// with `attention build` (RFC 0001 §5.11): a Hello panel in the left dock
// and a command to reveal it.
//
//	attention build --with example.com/attention-hello-ui=./examples/hello-ui -o ./attention-hello
package hello

import (
	"context"
	"strconv"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/layoutapi"
	"github.com/cunninghamcard-bit/attention/native/pluginreg"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
)

// Plugin adds the panel and its command while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "hello-ui",
	Inject: []string{"shell", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		clicks := 0
		offPanel := slotsapi.RegisterPanel(slotsapi.Panel{
			ID: "hello", Title: "Hello", Icon: lucide.Hand(), Dock: slotsapi.Left, Order: 9,
			View: func(c *ui.Context, _ slotsapi.PanelProps) {
				ui.Column(c).Fill().Padding(12).Gap(8).Children(func() {
					ui.Text(c, "Hello from a plugin built in with attention build.")
					if ui.Button(c, "Wave").Clicked() {
						clicks++
					}
					if clicks > 0 {
						ui.Text(c, "Waved "+strconv.Itoa(clicks)+" times").TextColor(c.Theme().TextMuted)
					}
				})
			},
		})
		reveal := func() {
			if l := layoutapi.Get(); l != nil {
				l.RevealPanel("hello")
			}
		}
		offCmd := actionsapi.Register(actionsapi.Command{ID: "hello-ui:open", Title: "Open Hello", Main: reveal, CLI: true,
			Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
				return shellapi.OnMain(ctx, func() (string, error) { reveal(); return "Hello panel open", nil })
			}})
		rctx.Effect(func(context.Context) error { offCmd(); offPanel(); return nil })
		return nil
	},
})

func init() { pluginreg.Add(Plugin, pluginreg.UI) }
