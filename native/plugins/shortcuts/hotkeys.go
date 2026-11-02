package shortcuts

import (
	"slices"
	"strings"

	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
)

var (
	hotkeyKeys = func() map[string]ui.Key {
		m := map[string]ui.Key{
			"Enter": ui.KeyEnter, "Escape": ui.KeyEscape, "Backspace": ui.KeyBackspace, "Tab": ui.KeyTab,
			"Space": ui.KeySpace, "Delete": ui.KeyDelete, "Insert": ui.KeyInsert, "Home": ui.KeyHome, "End": ui.KeyEnd,
			"PageUp": ui.KeyPageUp, "PageDown": ui.KeyPageDown, "ArrowLeft": ui.KeyLeft, "ArrowRight": ui.KeyRight,
			"ArrowUp": ui.KeyUp, "ArrowDown": ui.KeyDown, "-": ui.KeyMinus, "=": ui.KeyEqual, ",": ui.KeyComma, ".": ui.KeyPeriod,
			"/": ui.KeySlash, ";": ui.KeySemicolon, "'": ui.KeyQuote, "[": ui.KeyBracketLeft, "]": ui.KeyBracketRight,
			"\\": ui.KeyBackslash, "`": ui.KeyBackquote,
			"F1": ui.KeyF1, "F2": ui.KeyF2, "F3": ui.KeyF3, "F4": ui.KeyF4, "F5": ui.KeyF5, "F6": ui.KeyF6,
			"F7": ui.KeyF7, "F8": ui.KeyF8, "F9": ui.KeyF9, "F10": ui.KeyF10, "F11": ui.KeyF11, "F12": ui.KeyF12,
		}
		for name, k := range lettersAndDigits() {
			m[name] = k
		}
		return m
	}()

	hotkeyNames = func() map[ui.Key]string {
		m := make(map[ui.Key]string, len(hotkeyKeys))
		for name, k := range hotkeyKeys {
			m[k] = name
		}
		return m
	}()
)

// Hotkey is attention's Hotkey (apps/web/app/hotkeys/Keymap.ts) as
// hotkeys.json keeps it.
type Hotkey struct {
	Modifiers []string `json:"modifiers"`
	Key       string   `json:"key,omitempty"`
}

func (h Hotkey) binding() (Binding, bool) {
	k, ok := hotkeyKeys[h.Key]
	if !ok {
		return Binding{}, false
	}
	b := Binding{Key: k}
	for _, m := range h.Modifiers {
		switch m {
		case "Mod":
			b.Mods |= ui.Cmd
		case "Ctrl":
			b.Mods |= ui.Ctrl
		case "Meta":
			b.Mods |= ui.Super
		case "Alt":
			b.Mods |= ui.Alt
		case "Shift":
			b.Mods |= ui.Shift
		}
	}
	return b, true
}

// Overridden reports whether hotkeys.json sets id's hotkeys.
func (s *Shortcuts) Overridden(id string) bool {
	if s == nil {
		return false
	}
	var hs []Hotkey
	return s.settings.Get(settings.Hotkeys, id, &hs)
}

// Effective are a command's hotkeys: hotkeys.json's, else its defaults.
func (s *Shortcuts) Effective(cmd actions.Command) []Hotkey {
	if s != nil {
		var hs []Hotkey
		if s.settings.Get(settings.Hotkeys, cmd.ID, &hs) {
			return hs
		}
	}
	return Defaults(cmd.Keys)
}

// EffectiveLabel is a command's first hotkey formatted, "" for none.
func (s *Shortcuts) EffectiveLabel(cmd actions.Command) string {
	if hs := s.Effective(cmd); len(hs) > 0 {
		return Format(hs[0])
	}
	return ""
}

// Conflicts are the other commands that a hotkey of cmd's also triggers.
func (s *Shortcuts) Conflicts(cmd actions.Command, h Hotkey) []actions.Command {
	if s == nil {
		return nil
	}
	want, ok := signature(h)
	if !ok {
		return nil
	}
	var out []actions.Command
	for _, other := range s.actions.Commands() {
		if other.ID == cmd.ID {
			continue
		}
		for _, oh := range s.Effective(other) {
			if b, ok := signature(oh); ok && b == want {
				out = append(out, other)
				break
			}
		}
	}
	return out
}

// Defaults are a command's default hotkeys, from its Keys.
func Defaults(keys string) []Hotkey {
	var out []Hotkey
	for _, b := range Parse(keys) {
		out = append(out, hotkeyOf(b))
	}
	return out
}

// Format is formatHotkey off macOS: the modifiers, then the key, joined by " + ".
func Format(h Hotkey) string {
	labels := map[string]string{"Mod": "Ctrl", "Ctrl": "Ctrl", "Meta": "Win", "Alt": "Alt", "Shift": "Shift"}
	var parts []string
	for _, m := range []string{"Mod", "Ctrl", "Meta", "Alt", "Shift"} {
		if slices.Contains(h.Modifiers, m) {
			parts = append(parts, labels[m])
		}
	}
	key := h.Key
	switch key {
	case "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown":
		key = strings.TrimPrefix(key, "Arrow")
	}
	return strings.Join(append(parts, key), " + ")
}

func hotkeyOf(b Binding) Hotkey {
	h := Hotkey{Key: hotkeyNames[b.Key], Modifiers: []string{}}
	m := b.Mods
	if m&ui.Cmd != 0 {
		h.Modifiers = append(h.Modifiers, "Mod")
		m &^= ui.Cmd
	}
	if m&ui.Ctrl != 0 {
		h.Modifiers = append(h.Modifiers, "Ctrl")
	}
	if m&ui.Super != 0 {
		h.Modifiers = append(h.Modifiers, "Meta")
	}
	if m&ui.Alt != 0 {
		h.Modifiers = append(h.Modifiers, "Alt")
	}
	if m&ui.Shift != 0 {
		h.Modifiers = append(h.Modifiers, "Shift")
	}
	return h
}

func signature(h Hotkey) (Binding, bool) { return h.binding() }
