package shortcuts

import (
	"sort"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/settingsapi"
)

// The Hotkeys settings tab, attention's HotkeysSettingTab
// (apps/web/builtin/HotkeysSettingTab.ts): every titled command, its name
// and id, its hotkeys each with Remove hotkey, Add hotkey, which records
// the next combination, and Restore default hotkeys once it has been
// changed. A hotkey another command also has is marked, not refused.

// matching is getMatchingCommands: the titled commands whose name and id
// hold every word of the query, by name.
func matching(query string) []actionsapi.Command {
	tokens := strings.Fields(strings.ToLower(query))
	var out []actionsapi.Command
	for _, cmd := range actionsapi.List() {
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

// hotkeysTab draws the tab.
func (s *Shortcuts) hotkeysTab(c *ui.Context) {
	// The modal keeps the window's shortcuts from it: record here.
	if s.recording != "" {
		s.record(c)
	}
	omgui.SettingsSection(c, "Hotkeys", func() {
		omgui.SearchField(c, &s.filter, "Search commands...", false).Label("Search commands").FillWidth()
		for _, cmd := range matching(s.filter) {
			omgui.PreferenceRow(c, cmd.Title, cmd.ID, func() { s.commandHotkeys(c, cmd) })
		}
	})
}

// commandHotkeys is renderCommandHotkeys.
func (s *Shortcuts) commandHotkeys(c *ui.Context, cmd actionsapi.Command) {
	t := c.Theme()
	hs := Effective(cmd)
	ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
		if len(hs) == 0 {
			ui.Text(c, "No hotkey").FontSize(12).TextColor(t.TextMuted)
		}
		for i, h := range hs {
			conflicts := Conflicts(cmd, h)
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
					OnClick: func() { removeAt(cmd, i) }}).Tooltip("Remove hotkey")
			})
		}
		label, color := "Add hotkey", t.Text
		if s.recording == cmd.ID {
			label, color = "Press keys...", t.Accent
		}
		omgui.Button(c, omgui.ButtonProps{Label: label, Icon: lucide.Plus(), Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
			IconColor: color, OnClick: func() { s.recording = cmd.ID }}).Tooltip(label)
		if Overridden(cmd.ID) {
			omgui.Button(c, omgui.ButtonProps{Label: "Restore default hotkeys", Icon: lucide.RefreshCw(), Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
				IconColor: t.Accent, OnClick: func() { settingsapi.Unset(settingsapi.Hotkeys, cmd.ID) }}).Tooltip("Restore default hotkeys")
		}
	})
}

// removeAt is removeHotkeyAt: cmd's hotkeys less the i-th, kept as its
// override.
func removeAt(cmd actionsapi.Command, i int) {
	hs := Effective(cmd)
	if i >= len(hs) {
		return
	}
	settingsapi.Set(settingsapi.Hotkeys, cmd.ID, append(append([]Hotkey{}, hs[:i]...), hs[i+1:]...))
}
