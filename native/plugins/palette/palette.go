// Package palette is the palette UI plugin (RFC 0001 §6 palette-ui).
package palette

import (
	"context"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

// ID is the plugin's name and its overlay's.
const ID = "palette"

// Plugin draws the palette while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"slots"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var sl *slots.Registry
		if err := rctx.Use("slots", &sl); err != nil {
			return err
		}
		_, off := Register(sl)
		rctx.Effect(func(context.Context) error { off(); return nil })
		return nil
	},
})

// Palette is the modal's state, on the main thread only.
type Palette struct {
	slots    *slots.Registry
	open     string
	query    string
	ranked   string
	gen      int
	items    []slots.PaletteItem
	selected int
}

// Register draws the palette until off is called.
func Register(sl *slots.Registry) (p *Palette, off func()) {
	p = &Palette{slots: sl}
	return p, sl.RegisterOverlay(slots.Overlay{ID: ID, Order: 0, View: p.View})
}

// Open reports the shown source's ID, "" while closed.
func (p *Palette) Open() string { return p.open }

// Items are the rows shown.
func (p *Palette) Items() []slots.PaletteItem { return p.items }

// View draws the palette while it is open.
func (p *Palette) View(c *ui.Context) {
	if id, query := p.slots.TakePaletteRequest(); id != "" {
		p.show(id, query)
	}
	if p.open == "" {
		return
	}
	src := p.slots.LookupPaletteSource(p.open)
	if src == nil {
		p.close()
		return
	}
	t := c.Theme()
	if c.Shortcut(0, ui.KeyEscape) {
		p.close()
		return
	}
	p.rerank(*src)
	if c.Shortcut(0, ui.KeyDown) && p.selected+1 < len(p.items) {
		p.selected++
	}
	if c.Shortcut(0, ui.KeyUp) && p.selected > 0 {
		p.selected--
	}
	if c.Shortcut(ui.Cmd, ui.KeyEnter) {
		p.accept(*src, true)
		return
	}
	layer := ui.Column(c).Absolute().Top(0).Left(0).Right(0).Bottom(0).AlignItems(ui.Center).
		Background(aui.Shade(0.25))
	if layer.Clicked() {
		p.close()
	}
	layer.Children(func() {
		panel := ui.Column(c).Key("palette").MarginY(72).Width(640).MaxHeight(460).Clip()
		aui.Frost(c, panel, 12)
		panel.Children(func() {
			submitted := false
			ui.Row(c).FillWidth().Padding(10, 12).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
				field := aui.Field(c, &p.query, src.Placeholder, false).AutoFocus().FillWidth()
				if field.Submitted() {
					p.accept(*src, false)
					submitted = true
				}
			})
			if submitted {
				return
			}
			ui.Column(c).FillWidth().Padding(6).Children(func() {
				p.rows(c, *src)
			})
			if src.Footer != nil {
				ui.Row(c).FillWidth().Padding(6, 12).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Children(func() {
					src.Footer(c, p.query)
				})
			}
		})
	})
}

func (p *Palette) close() { p.open = "" }

func (p *Palette) show(id, query string) {
	if p.open == id && query == "" {
		p.close()
		return
	}
	src := p.slots.LookupPaletteSource(id)
	if src == nil {
		return
	}
	p.open, p.query, p.ranked, p.selected, p.items = id, query, "\x00", 0, nil
	if src.Open != nil {
		src.Open()
	}
}

func (p *Palette) rerank(src slots.PaletteSource) {
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

func (p *Palette) accept(src slots.PaletteSource, newTab bool) {
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

func (p *Palette) rows(c *ui.Context, src slots.PaletteSource) {
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
		props := aui.CommandRowProps{Key: it.Key, Label: it.Label, Detail: it.Detail, Icon: it.Icon, Selected: i == p.selected,
			OnClick: func() { p.selected = i; p.accept(src, false) }}
		if hint != "" {
			props.Trailing = func(c *ui.Context) { ui.Text(c, hint).FontSize(12).TextColor(c.Theme().TextMuted) }
		}
		aui.CommandRow(c, props)
	}).MaxHeight(380).FillWidth()
}
