// Package outline is the outline UI plugin: the right dock's Outline
// panel, a port of attention's OutlineView (apps/web/builtin/OutlineView.ts)
// over the index service's headings.
//
// Left out: code-file symbols (OutlineView.renderForCodeView); the reader
// has no CodeFileView.
package outline

import (
	"context"
	"fmt"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	indexplugin "github.com/cunninghamcard-bit/attention/native/plugins/index"
	"github.com/cunninghamcard-bit/attention/native/plugins/layout"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// ID is the plugin's name; PanelID the slot id (OutlineView.getViewType).
const (
	ID      = "outline-ui"
	PanelID = "outline"
)

// Plugin registers the Outline panel while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "slots", "layout", "workspace", "index", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh  *shell.Shell
			sl  *slots.Registry
			lyt *layout.Layout
			ws  *workspace.Workspace
			idx indexplugin.Index
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
		if err := rctx.Use("workspace", &ws); err != nil {
			return err
		}
		if err := rctx.Use("index", &idx); err != nil {
			return err
		}
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		p := &Pane{ctx: ctx, sh: sh, ws: ws, idx: idx}
		off := sl.RegisterPanel(slots.Panel{
			ID: PanelID, Title: "Outline", Icon: icon.Must("list"), Dock: slots.Right, Order: 2,
			View: p.view,
		})
		rctx.On(indexplugin.ChangedEvent, func(context.Context, ...any) (any, error) {
			sh.Update(p.fetch)
			return nil, nil
		})
		reveal := func() { lyt.RevealPanel(PanelID) }
		offCmd := act.Add(actions.Command{ID: "outline:open", Title: "Open outline", Main: reveal, Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, sh, func() (string, error) { reveal(); return "", nil })
		}})
		rctx.Effect(func(context.Context) error {
			offCmd()
			off()
			cancel()
			return nil
		})
		return nil
	},
})

// Pane is the panel's state, on the main thread only.
type Pane struct {
	ctx context.Context
	sh  *shell.Shell
	ws  *workspace.Workspace
	idx indexplugin.Index

	want     string // the active path last seen
	path     string // the path the headings are for
	seq      int
	cancel   context.CancelFunc
	loading  bool
	err      string
	headings []indexplugin.Heading
}

// sync starts a fetch when the active path moved. Called from View.
func (p *Pane) sync() {
	path := ""
	if p.ws != nil {
		if info, ok := p.ws.ActiveTab(); ok {
			path = info.Path
		}
	}
	if path == p.want {
		return
	}
	p.want = path
	p.fetch()
}

// fetch is Search.start: a newer seq drops a stale result. An empty path
// clears at once; the index is never called from View.
func (p *Pane) fetch() {
	if p.cancel != nil {
		p.cancel()
		p.cancel = nil
	}
	p.seq++
	seq := p.seq
	p.headings, p.err, p.loading, p.path = nil, "", false, p.want
	path := p.want
	if path == "" || p.ctx.Err() != nil {
		return
	}
	ctx, cancel := context.WithCancel(p.ctx)
	p.cancel = cancel
	p.loading = true
	go func() {
		hs, err := p.idx.Headings(ctx, path)
		p.sh.Update(func() {
			if seq != p.seq {
				return
			}
			p.loading, p.cancel = false, nil
			cancel()
			if err != nil {
				if ctx.Err() == nil {
					p.err = err.Error()
				}
				return
			}
			p.headings = hs
		})
	}()
}

func (p *Pane) view(c *ui.Context, _ slots.PanelProps) {
	p.sync()
	t := c.Theme()
	ui.Column(c).Fill().Children(func() {
		if p.want == "" {
			ui.Text(c, "No active file").TextColor(t.TextMuted).Padding(12)
			return
		}
		if p.err != "" {
			ui.Text(c, p.err).FontSize(12).TextColor(t.Danger).Padding(4, 12)
			return
		}
		if p.loading {
			ui.Text(c, "Loading…").TextColor(t.TextMuted).Padding(8, 12)
			return
		}
		if len(p.headings) == 0 {
			ui.Text(c, "No headings found").TextColor(t.TextMuted).Padding(12)
			return
		}
		hs := p.headings
		path := p.path
		ui.List(c, nil, len(hs), func(i int) {
			h := hs[i]
			depth := h.Level - 1
			if depth < 0 {
				depth = 0
			}
			item := aui.SideRow(c, aui.SideRowProps{Key: fmt.Sprintf("h:%d:%d", h.Line, i), Depth: depth})
			if item.Clicked() {
				if p.ws != nil {
					// Heading.Line is 0-based; Nav is 1-based (tabtypes.Nav).
					p.ws.Open(path, &workspace.Nav{Line: h.Line + 1}, false)
				}
			}
			item.Children(func() {
				ui.Text(c, h.Heading).FontSize(13).SingleLine().Ellipsis("…").Shrink(1)
			})
		}).Grow(1).FillWidth().PaddingY(4)
	})
}
