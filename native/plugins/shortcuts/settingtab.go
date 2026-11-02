package shortcuts

import (
	"sort"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
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
	omgui.SettingsSection(c, "Hotkeys", func() {
		omgui.SearchField(c, &s.filter, "Search commands...", false).Label("Search commands").FillWidth()
		for _, cmd := range s.matching(s.filter) {
			omgui.PreferenceRow(c, cmd.Title, cmd.ID, func() { s.commandHotkeys(c, cmd) })
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
				chip.BorderWidth(1).BorderColor(t.Danger).Tooltip("Conflicts with " + strings.Join(names, ", "))
			}
			chip.Children(func() {
				ui.Text(c, Format(h)).FontSize(12).SingleLine()
				omgui.Button(c, omgui.ButtonProps{Label: "Remove hotkey", Icon: lucide.X(), Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
					OnClick: func() { s.removeAt(cmd, i) }}).Tooltip("Remove hotkey")
			})
		}
		label, color := "Add hotkey", t.Text
		if s.recording == cmd.ID {
			label, color = "Press keys...", t.Accent
		}
		omgui.Button(c, omgui.ButtonProps{Label: label, Icon: lucide.Plus(), Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
			IconColor: color, OnClick: func() { s.recording = cmd.ID }}).Tooltip(label)
		if s.Overridden(cmd.ID) {
			omgui.Button(c, omgui.ButtonProps{Label: "Restore default hotkeys", Icon: lucide.RefreshCw(), Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
				IconColor: t.Accent, OnClick: func() { s.settings.Unset(settings.Hotkeys, cmd.ID) }}).Tooltip("Restore default hotkeys")
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
