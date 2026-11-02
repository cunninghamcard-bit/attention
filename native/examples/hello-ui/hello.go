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

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/layout"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
)

// Plugin adds the panel and its command while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "hello-ui",
	Inject: []string{"shell", "slots", "layout", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh  *shell.Shell
			sl  *slots.Registry
			lyt *layout.Layout
			act *actions.Service
		)
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		if err := rctx.Use("slots", &sl); err != nil {
			return err
		}
		if err := rctx.Use("layout", &lyt); err != nil {
			return err
		}
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		clicks := 0
		offPanel := sl.RegisterPanel(slots.Panel{
			ID: "hello", Title: "Hello", Icon: lucide.Hand(), Dock: slots.Left, Order: 9,
			View: func(c *ui.Context, _ slots.PanelProps) {
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
			if lyt != nil {
				lyt.RevealPanel("hello")
			}
		}
		offCmd := act.Add(actions.Command{ID: "hello-ui:open", Title: "Open Hello", Main: reveal, CLI: true,
			Run: func(ctx context.Context, _ actions.Args) (string, error) {
				return shell.OnMain(ctx, sh, func() (string, error) { reveal(); return "Hello panel open", nil })
			}})
		rctx.Effect(func(context.Context) error { offCmd(); offPanel(); return nil })
		return nil
	},
})
