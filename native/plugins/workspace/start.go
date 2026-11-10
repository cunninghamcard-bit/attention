package workspace

import (
	"fmt"
	"path"
	"path/filepath"
	"strings"

	"github.com/cunninghamcard-bit/acard-ui/components/button"
	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/fuzzy"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

// startPage is what a tab with nothing open shows (RFC 0003 §3): the
// omnibox's field, then the recent files and the projects, a project
// opening the omnibox on its files.
func (ws *Workspace) startPage(c *ui.Context) {
	t := c.Theme()
	ui.Scroll(c).Grow(1).Fill().Background(t.Background).Children(func() {
		ui.Column(c).FillWidth().AlignItems(ui.Center).Padding(96, 24, 24, 24).Children(func() {
			ui.Column(c).FillWidth().MaxWidth(560).Gap(10).Children(func() {
				aui.AddressBar(c, aui.AddressBarProps{Key: "start:omnibox", Icon: icon.Search.SVG(),
					Prefix: "Search tabs, files and commands, or enter a URL…", OnClick: func() { ws.sl.OpenPalette(omniboxID) }})
				if recent := ws.recentFiles[:min(len(ws.recentFiles), 8)]; len(recent) > 0 {
					aui.SectionLabel(c, "Recent").Margin(14, 10, 0, 10)
					ui.Column(c).FillWidth().Gap(1).Children(func() {
						for _, p := range recent {
							name, dir := filepath.Base(p), path.Dir(ws.display(p))
							aui.CommandRow(c, aui.CommandRowProps{Key: "start:" + p, Label: name, Detail: dir,
								Icon: ws.app.Icons().For(name), OnClick: func() { ws.later(func() { ws.open(p, nil) }) }})
						}
					})
				}
				if len(ws.mounts) > 0 {
					aui.SectionLabel(c, "Projects").Margin(14, 10, 0, 10)
					ui.Row(c).FillWidth().Wrap().Gap(8).PaddingX(6).Children(func() {
						for _, m := range ws.mounts {
							col, _ := aui.ParseColor(m.Color)
							project := button.Button(c, button.ButtonProps{Variant: button.ButtonSecondary, LabelKey: m.Name, Children: func() {
								ui.Icon(c, icon.Folder.SVG()).Size(16, 16).TextColor(col)
								ui.Text(c, m.Name)
							}})
							if project.Clicked() {
								ws.sl.OpenPaletteQuery(omniboxID, m.Name+"/")
							}
						}
					})
				}
			})
		})
	})
}

// tabsSource is the open tabs as a palette source, pinned ones
// included, for the omnibox to switch to.
func (ws *Workspace) tabsSource() slots.PaletteSource {
	return slots.PaletteSource{
		ID:    tabsSourceID,
		Items: ws.tabItems,
		Empty: func(string) string { return "No matches" },
	}
}

// tabItems are the cards whose title or address match query; none for no
// query.
func (ws *Workspace) tabItems(query string) []slots.PaletteItem {
	if strings.TrimSpace(query) == "" {
		return nil
	}
	type card struct {
		it   *node
		g    *pane
		text string
	}
	var cards []card
	for _, it := range ws.listedItems() {
		for _, g := range it.groups(nil) {
			if entry, title := ws.cardEntry(g); entry != "" {
				cards = append(cards, card{it, g, title + " " + ws.display(entry)})
			}
		}
	}
	var out []slots.PaletteItem
	for _, r := range fuzzy.Rank(query, len(cards), func(i int) string { return cards[i].text }, 20) {
		cd := cards[r.Index]
		entry, title := ws.cardEntry(cd.g)
		glyph := icon.Globe.SVG()
		switch t := cd.g.current(); {
		case t != nil:
			glyph = ws.tabIcon(t)
		case !tabtypes.WebAddress(entry):
			glyph = ws.app.Icons().For(title)
		}
		out = append(out, slots.PaletteItem{Key: fmt.Sprintf("tab:%d", cd.g.id), Label: title, Detail: ws.display(entry),
			Icon: glyph, Hint: "Switch to tab", Choose: func(bool) {
				ws.showItem(cd.it)
				ws.focusGroup(cd.g)
			}})
	}
	return out
}
