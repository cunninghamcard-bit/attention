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
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	indexcontract "github.com/cunninghamcard-bit/attention/native/contract/index"
	"github.com/cunninghamcard-bit/attention/native/layoutapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// ID is the plugin's name; PanelID the slot id (OutlineView.getViewType).
const (
	ID      = "outline-ui"
	PanelID = "outline"
)

// Pane is the panel's state, on the main thread only.
type Pane struct {
	ctx context.Context
	idx indexcontract.Index

	want     string // the active path last seen
	path     string // the path the headings are for
	seq      int
	cancel   context.CancelFunc
	loading  bool
	err      string
	headings []indexcontract.Heading
}

// Plugin registers the Outline panel while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "index", "workspace"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var idx indexcontract.Index
		if err := rctx.Use("index", &idx); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		p := &Pane{ctx: ctx, idx: idx}
		off := slotsapi.RegisterPanel(slotsapi.Panel{
			ID: PanelID, Title: "Outline", Icon: lucide.List(), Dock: slotsapi.Right, Order: 2,
			View: p.view,
		})
		rctx.On(indexcontract.ChangedEvent, func(context.Context, ...any) (any, error) {
			shellapi.Update(p.fetch)
			return nil, nil
		})
		reveal := func() {
			if l := layoutapi.Get(); l != nil {
				l.RevealPanel(PanelID)
			}
		}
		offCmd := actionsapi.Register(actionsapi.Command{ID: "outline:open", Title: "Open outline", Main: reveal, Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			return shellapi.OnMain(ctx, func() (string, error) { reveal(); return "", nil })
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

// sync starts a fetch when the active path moved. Called from View.
func (p *Pane) sync() {
	path := ""
	if ws := workspaceapi.Get(); ws != nil {
		if info, ok := ws.ActiveTab(); ok {
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
		shellapi.Update(func() {
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

func (p *Pane) view(c *ui.Context, _ slotsapi.PanelProps) {
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
			item := omgui.SideRow(c, omgui.SideRowProps{Key: fmt.Sprintf("h:%d:%d", h.Line, i), Depth: depth})
			if item.Clicked() {
				if ws := workspaceapi.Get(); ws != nil {
					// Heading.Line is 0-based; Nav is 1-based (tabtypesapi.Nav).
					ws.Open(path, &workspaceapi.Nav{Line: h.Line + 1}, false)
				}
			}
			item.Children(func() {
				ui.Text(c, h.Heading).FontSize(13).SingleLine().Ellipsis("…").Shrink(1)
			})
		}).Grow(1).FillWidth().PaddingY(4)
	})
}
