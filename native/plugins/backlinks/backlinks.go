// Package backlinks is the backlinks UI plugin: the right dock's
// Backlinks panel, a port of attention's BacklinksView
// (apps/web/builtin/BacklinksView.ts) over the index service's linked
// mentions.
//
// On a web page's tab it lists the notes and pages citing its URL
// (indexcontract URLBacklinks), the reader's own.
//
// Left out: Unlinked mentions (the TS view renders that section empty).
package backlinks

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention-ui/theme"
	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	indexcontract "github.com/cunninghamcard-bit/attention/native/contract/index"
	"github.com/cunninghamcard-bit/attention/native/internal/fileicon"
	"github.com/cunninghamcard-bit/attention/native/layoutapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// ID is the plugin's name; PanelID the slot id (BacklinksView.getViewType).
const (
	ID      = "backlinks-ui"
	PanelID = "backlink"
)

// Pane is the panel's state, on the main thread only.
type Pane struct {
	ctx context.Context
	idx indexcontract.Index

	want      string // the active path, or web page's URL, last seen
	web       bool   // want is a URL
	seq       int
	cancel    context.CancelFunc
	loading   bool
	err       string
	results   []indexcontract.Backlink
	collapsed map[string]bool // per source note
	rows      []row
	dirty     bool
}

// row is a source title or one of its mentions.
type row struct {
	src     *indexcontract.Backlink
	mention int // -1 on the source's title
}

// Plugin registers the Backlinks panel while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "index", "workspace"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var idx indexcontract.Index
		if err := rctx.Use("index", &idx); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		p := &Pane{ctx: ctx, idx: idx, collapsed: map[string]bool{}}
		off := slotsapi.RegisterPanel(slotsapi.Panel{
			ID: PanelID, Title: "Backlinks", Icon: lucide.Link(), Dock: slotsapi.Right, Order: 1,
			View: p.view, State: p.state, Restore: p.restore,
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
		offCmd := actionsapi.Register(actionsapi.Command{ID: "backlink:open", Title: "Open backlinks", Main: reveal, Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
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

// savedState is which source files the user collapsed.
type savedState struct {
	Collapsed []string `json:"collapsed"`
}

func (p *Pane) state() json.RawMessage {
	var collapsed []string
	for path, on := range p.collapsed {
		if on {
			collapsed = append(collapsed, path)
		}
	}
	sort.Strings(collapsed)
	data, _ := json.Marshal(savedState{Collapsed: collapsed})
	return data
}

func (p *Pane) restore(data json.RawMessage) {
	var st savedState
	if json.Unmarshal(data, &st) != nil {
		return
	}
	p.collapsed = map[string]bool{}
	for _, path := range st.Collapsed {
		if path != "" {
			p.collapsed[path] = true
		}
	}
}

// sync starts a fetch when the active path moved. Called from View.
func (p *Pane) sync() {
	path, web := "", false
	if ws := workspaceapi.Get(); ws != nil {
		if info, ok := ws.ActiveTab(); ok {
			path = info.Path
			if path == "" && info.Kind == webKind {
				path, web = info.Address, true
			}
		}
	}
	if path == p.want {
		return
	}
	p.want, p.web = path, web
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
	p.results, p.err, p.loading, p.dirty = nil, "", false, true
	path, web := p.want, p.web
	if path == "" || p.ctx.Err() != nil {
		return
	}
	ctx, cancel := context.WithCancel(p.ctx)
	p.cancel = cancel
	p.loading = true
	go func() {
		backlinks := p.idx.Backlinks
		if web {
			backlinks = p.idx.URLBacklinks
		}
		res, err := backlinks(ctx, path)
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
			p.results = res
			p.dirty = true
		})
	}()
}

func (p *Pane) flatten() []row {
	if !p.dirty {
		return p.rows
	}
	p.rows = p.rows[:0]
	for i := range p.results {
		b := &p.results[i]
		p.rows = append(p.rows, row{src: b, mention: -1})
		if p.collapsed[b.Path+b.URL] {
			continue
		}
		for m := range b.Mentions {
			p.rows = append(p.rows, row{src: b, mention: m})
		}
	}
	p.dirty = false
	return p.rows
}

func (p *Pane) mentionCount() int {
	n := 0
	for _, b := range p.results {
		n += len(b.Mentions)
	}
	return n
}

// webKind is the web viewer's tab kind.
const webKind = "webviewer"

// open shows a backlink's source: a note at the mention, a web page in a
// web tab.
func open(b *indexcontract.Backlink, m *indexcontract.Mention) {
	ws := workspaceapi.Get()
	if ws == nil {
		return
	}
	if b.URL != "" {
		_ = ws.OpenResource(b.URL, workspaceapi.OpenOptions{Kind: webKind})
		return
	}
	path := b.Path
	var nav *workspaceapi.Nav
	if m != nil {
		// Mention.Line/Col are 0-based; Nav is 1-based (tabtypesapi.Nav).
		nav = &workspaceapi.Nav{Line: m.Line + 1, Col: m.Col + 1, Len: m.Len}
	}
	ws.Open(path, nav, false)
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
		if len(p.results) == 0 {
			ui.Text(c, "No backlinks found.").TextColor(t.TextMuted).Padding(12)
			return
		}
		n := p.mentionCount()
		ui.Text(c, fmt.Sprintf("Linked mentions %d", n)).FontSize(12).TextColor(t.TextMuted).Padding(4, 12)
		rows := p.flatten()
		ui.List(c, nil, len(rows), func(i int) {
			r := rows[i]
			b := r.src
			if r.mention < 0 {
				p.fileRow(c, b)
				return
			}
			m := &b.Mentions[r.mention]
			item := omgui.SideRow(c, omgui.SideRowProps{Key: fmt.Sprintf("m:%s%s:%d", b.Path, b.URL, r.mention), Depth: 2})
			if item.Clicked() {
				open(b, m)
			}
			item.Children(func() {
				highlighted(c, m)
			})
		}).Grow(1).FillWidth().PaddingY(4)
	})
}

func (p *Pane) fileRow(c *ui.Context, b *indexcontract.Backlink) {
	t := c.Theme()
	item := omgui.SideRow(c, omgui.SideRowProps{Key: "f:" + b.Path + b.URL, Depth: 0})
	if item.Clicked() {
		var first *indexcontract.Mention
		if len(b.Mentions) > 0 {
			first = &b.Mentions[0]
		}
		open(b, first)
	}
	item.Tooltip(b.Display)
	item.Children(func() {
		if len(b.Mentions) > 0 {
			chevron := lucide.ChevronDown()
			if p.collapsed[b.Path+b.URL] {
				chevron = lucide.ChevronRight()
			}
			if ui.Icon(c, chevron).Size(14, 14).TextColor(t.TextMuted).Shrink(0).Cursor(ui.CursorPointer).Clicked() {
				p.collapsed[b.Path+b.URL] = !p.collapsed[b.Path+b.URL]
				p.dirty = true
			}
		} else {
			ui.Box(c).Width(14).Shrink(0)
		}
		icon := fileicon.For(b.Display)
		if b.URL != "" {
			icon = lucide.Globe()
		}
		ui.Icon(c, icon).Size(14, 14).TextColor(t.TextMuted).Shrink(0)
		ui.Text(c, b.Display).FontSize(13).SingleLine().Ellipsis("…").Shrink(1)
		if len(b.Mentions) > 0 {
			ui.Text(c, strconv.Itoa(len(b.Mentions))).FontSize(11).TextColor(t.TextMuted).Shrink(0)
		}
	})
}

// highlighted is a mention as "line: text" with the link marked
// (BacklinksView.appendHighlightedText). Col is 0-based bytes in Text.
func highlighted(c *ui.Context, m *indexcontract.Mention) {
	t := c.Theme()
	text := m.Text
	from := min(max(0, m.Col), len(text))
	to := min(from+m.Len, len(text))
	spans := []ui.Span{{Text: strconv.Itoa(m.Line+1) + ": ", Color: t.TextMuted}}
	if from > 0 {
		spans = append(spans, ui.Span{Text: text[:from]})
	}
	spans = append(spans, ui.Span{Text: text[from:to], Background: t.Selection})
	if to < len(text) {
		spans = append(spans, ui.Span{Text: text[to:]})
	}
	ui.RichText(c, spans...).FontSize(12).Font(theme.MonoFont).SingleLine().Ellipsis("…").Shrink(1)
}
