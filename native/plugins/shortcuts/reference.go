package shortcuts

import (
	"sort"
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/natural"
	"github.com/cunninghamcard-bit/attention/native/settingsapi"
)

// The keyboard shortcuts reference, dsh's ui-shortcuts Reference: a
// 480×600 dialog of every titled command and its binding, searched; a row
// clicked records its binding in place, Remove clears it, Restore default
// drops the override, and the footer restores them all.

// subsequence reports whether q's letters appear in s in order, without
// case (dsh's search: an ordered subsequence within a label or keys).
func subsequence(s, q string) bool {
	s, q = strings.ToLower(s), strings.ToLower(q)
	for _, r := range q {
		i := strings.IndexRune(s, r)
		if i < 0 {
			return false
		}
		s = s[i+len(string(r)):]
	}
	return true
}

// keysLabel is a command's bindings as its row shows them.
func keysLabel(hs []Hotkey) string {
	parts := make([]string, len(hs))
	for i, h := range hs {
		parts[i] = Format(h)
	}
	return strings.Join(parts, ", ")
}

// overrides counts the commands whose bindings hotkeys.json sets.
func overrides() int { return len(settingsapi.Keys(settingsapi.Hotkeys)) }

// referenceView draws the dialog while it is open.
func (s *Shortcuts) referenceView(c *ui.Context) {
	if !s.refOpen {
		s.recording, s.recordErr, s.confirming = "", "", false
		return
	}
	_, winH := c.Size()
	omgui.Dialog(c, omgui.DialogProps{Open: &s.refOpen, Key: "keyboard-shortcuts", Title: "Keyboard shortcuts", Width: 480,
		MaxHeight: min(600, winH-48), Body: s.referenceBody})
}

func (s *Shortcuts) referenceBody(c *ui.Context) {
	t := c.Theme()
	// The modal keeps the window's shortcuts from it: record, and let its
	// own shortcut close it, here.
	if s.recording != "" {
		s.record(c)
	} else if c.Shortcut(ui.Cmd, ui.KeySlash) {
		s.refOpen = false
		return
	}
	omgui.Field(c, &s.filter, "Search", false).AutoFocus().FillWidth()
	cmds := actionsapi.List()
	sort.SliceStable(cmds, func(i, j int) bool { return natural.Less(cmds[i].Title, cmds[j].Title) })
	ui.Scroll(c).FillWidth().Height(420).Children(func() {
		ui.Column(c).FillWidth().Gap(2).Children(func() {
			for _, cmd := range cmds {
				hs := Effective(cmd)
				label := keysLabel(hs)
				if cmd.Title == "" || s.filter != "" && !subsequence(cmd.Title, s.filter) && !subsequence(label, s.filter) {
					continue
				}
				s.referenceRow(c, cmd, hs, label)
			}
		})
	})
	ui.Row(c).FillWidth().Gap(8).AlignItems(ui.Center).PaddingY(4).Children(func() {
		n := overrides()
		if s.confirming {
			ui.Text(c, "Restore every shortcut to its default?").FontSize(12).Grow(1)
			omgui.Button(c, omgui.ButtonProps{Label: "Cancel", Variant: omgui.ButtonSecondary, OnClick: func() { s.confirming = false }})
			omgui.Button(c, omgui.ButtonProps{Label: "Restore", Variant: omgui.ButtonDanger, OnClick: func() {
				for id := range settingsapi.Keys(settingsapi.Hotkeys) {
					settingsapi.Unset(settingsapi.Hotkeys, id)
				}
				s.confirming = false
			}})
			return
		}
		omgui.Button(c, omgui.ButtonProps{Label: "Restore all defaults", Variant: omgui.ButtonSecondary, Disabled: n == 0,
			OnClick: func() { s.confirming = true }})
		if n > 0 {
			ui.Text(c, strconv.Itoa(n)+" changed").FontSize(12).TextColor(t.TextMuted)
		}
	})
}

// referenceRow is a command's 42-high row: its name, then its binding in a
// grey block, or the recorder while it records; Remove and Restore
// default beside.
func (s *Shortcuts) referenceRow(c *ui.Context, cmd actionsapi.Command, hs []Hotkey, label string) {
	t := c.Theme()
	recording := s.recording == cmd.ID
	row := ui.Row(c).Key("shortcut:" + cmd.ID).FillWidth().Height(42).PaddingX(8).Gap(8).AlignItems(ui.Center).Radius(8).Cursor(ui.CursorPointer)
	if row.Hovered() || recording {
		row.Background(t.SurfaceHover)
	}
	if row.Clicked() && !recording {
		s.recording, s.recordErr = cmd.ID, ""
	}
	row.Children(func() {
		ui.Text(c, cmd.Title).FontSize(13).MaxLines(1).Grow(1).MinWidth(0)
		switch {
		case recording:
			msg := "Press keys…"
			color := t.TextMuted
			if s.recordErr != "" {
				msg, color = s.recordErr, t.Danger
			}
			ui.Box(c).Height(24).PaddingX(8).Radius(6).BorderWidth(1).BorderColor(color).Center().Children(func() {
				ui.Text(c, msg).FontSize(12).TextColor(color).SingleLine()
			})
		case label == "":
			ui.Text(c, "No shortcut").FontSize(12).TextColor(t.TextMuted)
		default:
			ui.Box(c).Height(24).PaddingX(8).Radius(6).Background(t.Surface).Center().Children(func() {
				ui.Text(c, label).FontSize(12).TextColor(t.TextMuted).SingleLine()
			})
		}
		if len(hs) > 0 && !recording {
			omgui.Button(c, omgui.ButtonProps{Label: "Remove", Icon: lucide.X(), Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
				OnClick: func() { settingsapi.Set(settingsapi.Hotkeys, cmd.ID, []Hotkey{}) }}).Tooltip("Remove")
		}
		if Overridden(cmd.ID) && !recording {
			omgui.Button(c, omgui.ButtonProps{Label: "Restore default", Icon: lucide.RotateCcw(), Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
				OnClick: func() { settingsapi.Unset(settingsapi.Hotkeys, cmd.ID) }}).Tooltip("Restore default")
		}
	})
}

// shortcutsRow is the General page's Keyboard shortcuts row (dsh's Edit
// shortcuts entry), its button's tooltip the reference's own binding.
func (s *Shortcuts) shortcutsRow(c *ui.Context) {
	omgui.PreferenceRow(c, "Keyboard shortcuts", "", func() {
		b := omgui.Button(c, omgui.ButtonProps{Label: "Edit shortcuts", Variant: omgui.ButtonSecondary, OnClick: func() { s.refOpen = true }})
		if cmd, ok := actionsapi.Lookup(referenceID); ok {
			if l := EffectiveLabel(cmd); l != "" {
				b.Tooltip("Open from anywhere: " + l)
			}
		}
	})
}
