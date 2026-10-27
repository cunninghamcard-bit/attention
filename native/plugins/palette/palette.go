// Package palette is the palette UI plugin (RFC 0001 §6 palette-ui): the
// modal over the window that the palette.source plugins fill — attention's
// SuggestModal (apps/web/ui/suggest/SuggestModal.ts) with the quick
// switcher's, the command palette's and go to line's rows. It owns the
// field, the selection and the keys; a source owns its rows.
package palette

import (
	"context"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
)

// ID is the plugin's name and its overlay's.
const ID = "palette"

// Palette is the modal's state, on the main thread only.
type Palette struct {
	open     string // the shown source's ID, "" while closed
	query    string
	ranked   string // the query the items are for
	gen      int    // the source's Generation they are for
	items    []slotsapi.PaletteItem
	selected int
}

// Open reports the shown source's ID, "" while closed.
func (p *Palette) Open() string { return p.open }

// Items are the rows shown.
func (p *Palette) Items() []slotsapi.PaletteItem { return p.items }

func (p *Palette) close() { p.open = "" }

// show opens source id, or closes the palette when it shows id already
// (the same shortcut toggles it).
func (p *Palette) show(id string) {
	if p.open == id {
		p.close()
		return
	}
	src, ok := slotsapi.LookupPaletteSource(id)
	if !ok {
		return
	}
	p.open, p.query, p.ranked, p.selected, p.items = id, "", "\x00", 0, nil
	if src.Open != nil {
		src.Open()
	}
}

// rerank asks the source again when the query or its generation changed.
func (p *Palette) rerank(src slotsapi.PaletteSource) {
	gen := 0
	if src.Generation != nil {
		gen = src.Generation()
	}
	if p.ranked == p.query && p.gen == gen {
		return
	}
	if p.ranked != p.query {
		p.selected = 0
	}
	p.ranked, p.gen = p.query, gen
	p.items = nil
	if src.Items != nil {
		p.items = src.Items(p.query)
	}
	p.selected = min(p.selected, max(0, len(p.items)-1))
}

// accept chooses the selected row, or submits the query without one.
func (p *Palette) accept(src slotsapi.PaletteSource, newTab bool) {
	if p.selected < len(p.items) {
		it := p.items[p.selected]
		p.close()
		if it.Choose != nil {
			it.Choose(newTab)
		}
		return
	}
	if src.Submit != nil && src.Submit(p.query) {
		p.close()
	}
}

// View draws the palette while it is open.
func (p *Palette) View(c *ui.Context) {
	if id := slotsapi.TakePaletteRequest(); id != "" {
		p.show(id)
	}
	if p.open == "" {
		return
	}
	src, ok := slotsapi.LookupPaletteSource(p.open)
	if !ok {
		p.close() // its plugin unloaded
		return
	}
	t := c.Theme()
	if c.Shortcut(0, ui.KeyEscape) {
		p.close()
		return
	}
	p.rerank(src)
	if c.Shortcut(0, ui.KeyDown) && p.selected+1 < len(p.items) {
		p.selected++
	}
	if c.Shortcut(0, ui.KeyUp) && p.selected > 0 {
		p.selected--
	}
	if c.Shortcut(ui.Cmd, ui.KeyEnter) {
		p.accept(src, true)
		return
	}
	// A full-window layer: a click outside the panel closes it.
	layer := ui.Column(c).Absolute().Top(0).Left(0).Right(0).Bottom(0).AlignItems(ui.Center)
	if layer.Clicked() {
		p.close()
	}
	layer.Children(func() {
		panel := ui.Column(c).Key("palette").MarginY(64).Width(600).MaxHeight(440).
			Background(t.Background).Radius(10).BorderWidth(1).BorderColor(t.Border).Padding(6).Gap(4)
		panel.Children(func() {
			field := omgui.Field(c, &p.query, src.Placeholder, false).AutoFocus().FillWidth()
			if field.Submitted() {
				p.accept(src, false)
				return
			}
			p.rows(c, src)
			if src.Footer != nil {
				src.Footer(c, p.query)
			}
		})
	})
}

func (p *Palette) rows(c *ui.Context, src slotsapi.PaletteSource) {
	t := c.Theme()
	if len(p.items) == 0 {
		if src.Empty != nil {
			if msg := src.Empty(p.query); msg != "" {
				ui.Text(c, msg).TextColor(t.TextMuted).FontSize(12).Padding(6, 8)
			}
		}
		return
	}
	ui.List(c, nil, len(p.items), func(i int) {
		it := p.items[i]
		hint := it.Hint
		props := omgui.CommandRowProps{Key: it.Key, Label: it.Label, Detail: it.Detail, Icon: it.Icon, Selected: i == p.selected,
			OnClick: func() { p.selected = i; p.accept(src, false) }}
		if hint != "" {
			props.Trailing = func(c *ui.Context) { ui.Text(c, hint).FontSize(12).TextColor(c.Theme().TextMuted) }
		}
		omgui.CommandRow(c, props)
	}).MaxHeight(380).FillWidth()
}

// Register draws the palette until off is called.
func Register() (p *Palette, off func()) {
	p = &Palette{}
	return p, slotsapi.RegisterOverlay(slotsapi.Overlay{ID: ID, Order: 0, View: p.View})
}

// Plugin draws the palette while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		_, off := Register()
		rctx.Effect(func(context.Context) error { off(); return nil })
		return nil
	},
})
