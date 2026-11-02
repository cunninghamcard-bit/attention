package ui

import (
	"github.com/egoist/mygo/ui"
)

// SettingsSection is a settings group: a caption, then body's rows in one
// hairline card, divided (omgui's PreferenceSection).
func SettingsSection(c *ui.Context, title string, body func()) ui.Element {
	t := c.Theme()
	col := ui.Column(c).FillWidth().Gap(8)
	col.Children(func() {
		if title != "" {
			SectionLabel(c, title).PaddingX(8)
		}
		ui.Column(c).FillWidth().PaddingX(16).Radius(t.Radius).Border(1, t.Border).Background(control(t)).
			Dividers(1, t.Border).Children(body)
	})
	return col
}

// PreferenceRow is one settings row: label and description at the start,
// trailing at the end.
func PreferenceRow(c *ui.Context, label, description string, trailing func()) ui.Element {
	t := c.Theme()
	row := ui.Row(c).FillWidth().MinHeight(56).PaddingY(12).Gap(16).AlignItems(ui.Center)
	row.Children(func() {
		ui.Column(c).Grow(1).MinWidth(0).Gap(2).Children(func() {
			ui.Text(c, label).FontSize(labelSize).FontWeight(500).FillWidth()
			if description != "" {
				ui.Text(c, description).FontSize(smallSize).TextColor(t.TextMuted).FillWidth()
			}
		})
		if trailing != nil {
			ui.Column(c).Shrink(0).AlignItems(ui.End).Children(trailing)
		}
	})
	return row
}
