package shortcuts

import (
	"sort"
	"strings"

	"github.com/cunninghamcard-bit/acard-ui/components/button"
	"github.com/cunninghamcard-bit/acard-ui/components/tooltip"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

func (s *Shortcuts) matching(query string) []actions.Command {
	tokens := strings.Fields(strings.ToLower(query))
	var out []actions.Command
	for _, cmd := range s.actions.Commands() {
		if cmd.Title == "" {
			continue
		}
		hay := strings.ToLower(cmd.Title + " " + cmd.ID)
		ok := true
		for _, tok := range tokens {
			ok = ok && strings.Contains(hay, tok)
		}
		if ok {
			out = append(out, cmd)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Title < out[j].Title })
	return out
}

func (s *Shortcuts) hotkeysTab(c *ui.Context) {
	if s.recording != "" {
		s.record(c)
	}
	aui.SettingsSection(c, "Hotkeys", func() {
		aui.SearchField(c, &s.filter, "Search commands...", false).Label("Search commands").FillWidth()
		for _, cmd := range s.matching(s.filter) {
			aui.PreferenceRow(c, cmd.Title, cmd.ID, func() { s.commandHotkeys(c, cmd) })
		}
	})
}

func (s *Shortcuts) commandHotkeys(c *ui.Context, cmd actions.Command) {
	t := c.Theme()
	hs := s.Effective(cmd)
	ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
		if len(hs) == 0 {
			ui.Text(c, "No hotkey").FontSize(12).TextColor(t.TextMuted)
		}
		for i, h := range hs {
			conflicts := s.Conflicts(cmd, h)
			chip := ui.Row(c).Key("hotkey:"+cmd.ID+":"+Format(h)).Height(24).Padding(0, 2, 0, 8).Gap(2).Radius(6).
				Background(t.Surface).AlignItems(ui.Center)
			if len(conflicts) > 0 {
				names := make([]string, len(conflicts))
				for j, o := range conflicts {
					names[j] = o.Title
				}
				tooltip.Tooltip(c, chip.BorderWidth(1).BorderColor(t.Danger), tooltip.TooltipProps{Text: "Conflicts with " + strings.Join(names, ", ")})
			}
			chip.Children(func() {
				ui.Text(c, Format(h)).FontSize(12).SingleLine()
				remove := button.Button(c, button.ButtonProps{Label: "Remove hotkey", Variant: button.ButtonGhost, Size: button.ButtonSm,
					Children: func() { ui.Icon(c, icon.Must("x")).Size(14, 14) }}).Width(28).PaddingX(0)
				if remove.Clicked() {
					s.removeAt(cmd, i)
				}
				tooltip.Tooltip(c, remove, tooltip.TooltipProps{Text: "Remove hotkey"})
			})
		}
		label, color := "Add hotkey", t.Text
		if s.recording == cmd.ID {
			label, color = "Press keys...", t.Accent
		}
		add := button.Button(c, button.ButtonProps{Label: label, Variant: button.ButtonGhost, Size: button.ButtonSm,
			Children: func() { ui.Icon(c, icon.Must("plus")).Size(14, 14).TextColor(color) }}).Width(28).PaddingX(0)
		if add.Clicked() {
			s.recording = cmd.ID
		}
		tooltip.Tooltip(c, add, tooltip.TooltipProps{Text: label})
		if s.Overridden(cmd.ID) {
			restore := button.Button(c, button.ButtonProps{Label: "Restore default hotkeys", Variant: button.ButtonGhost,
				Size:     button.ButtonSm,
				Children: func() { ui.Icon(c, icon.Must("refresh-cw")).Size(14, 14).TextColor(t.Accent) }}).Width(28).PaddingX(0)
			if restore.Clicked() {
				s.settings.Unset(settings.Hotkeys, cmd.ID)
			}
			tooltip.Tooltip(c, restore, tooltip.TooltipProps{Text: "Restore default hotkeys"})
		}
	})
}

func (s *Shortcuts) removeAt(cmd actions.Command, i int) {
	hs := s.Effective(cmd)
	if i >= len(hs) {
		return
	}
	s.settings.Set(settings.Hotkeys, cmd.ID, append(append([]Hotkey{}, hs[:i]...), hs[i+1:]...))
}
