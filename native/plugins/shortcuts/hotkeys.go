package shortcuts

import (
	"slices"
	"strings"

	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/settingsapi"
)

var (
	// hotkeyKeys are the key names a Hotkey uses; letters and digits are
	// added by init.
	hotkeyKeys = map[string]ui.Key{
		"Enter": ui.KeyEnter, "Escape": ui.KeyEscape, "Backspace": ui.KeyBackspace, "Tab": ui.KeyTab,
		"Space": ui.KeySpace, "Delete": ui.KeyDelete, "Insert": ui.KeyInsert, "Home": ui.KeyHome, "End": ui.KeyEnd,
		"PageUp": ui.KeyPageUp, "PageDown": ui.KeyPageDown, "ArrowLeft": ui.KeyLeft, "ArrowRight": ui.KeyRight,
		"ArrowUp": ui.KeyUp, "ArrowDown": ui.KeyDown, "-": ui.KeyMinus, "=": ui.KeyEqual, ",": ui.KeyComma, ".": ui.KeyPeriod,
		"/": ui.KeySlash, ";": ui.KeySemicolon, "'": ui.KeyQuote, "[": ui.KeyBracketLeft, "]": ui.KeyBracketRight,
		"\\": ui.KeyBackslash, "`": ui.KeyBackquote,
		"F1": ui.KeyF1, "F2": ui.KeyF2, "F3": ui.KeyF3, "F4": ui.KeyF4, "F5": ui.KeyF5, "F6": ui.KeyF6,
		"F7": ui.KeyF7, "F8": ui.KeyF8, "F9": ui.KeyF9, "F10": ui.KeyF10, "F11": ui.KeyF11, "F12": ui.KeyF12,
	}

	// hotkeyNames names each key a Hotkey can hold.
	hotkeyNames = map[ui.Key]string{}
)

func init() {
	for name, k := range lettersAndDigits() {
		hotkeyKeys[name] = k
	}
	for name, k := range hotkeyKeys {
		hotkeyNames[k] = name
	}
}

// Hotkey is attention's Hotkey (apps/web/app/hotkeys/Keymap.ts) as
// hotkeys.json keeps it: modifiers Mod (the platform's command key), Ctrl,
// Meta, Alt, Shift, and a key named as KeyboardEvent.key names it.
type Hotkey struct {
	Modifiers []string `json:"modifiers"`
	Key       string   `json:"key,omitempty"`
}

// hotkeyOf is b as a Hotkey: the platform's command key as Mod.
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

// binding is the combination h names, false for a key it cannot.
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

// Defaults are a command's default hotkeys, from its Keys.
func Defaults(keys string) []Hotkey {
	var out []Hotkey
	for _, b := range Parse(keys) {
		out = append(out, hotkeyOf(b))
	}
	return out
}

// Overridden reports whether hotkeys.json sets id's hotkeys
// (HotkeyManager.hasHotkeyOverride).
func Overridden(id string) bool {
	var hs []Hotkey
	return settingsapi.Get(settingsapi.Hotkeys, id, &hs)
}

// Effective are a command's hotkeys: hotkeys.json's, else its defaults
// (HotkeyManager.getEffectiveHotkeys).
func Effective(cmd actionsapi.Command) []Hotkey {
	var hs []Hotkey
	if settingsapi.Get(settingsapi.Hotkeys, cmd.ID, &hs) {
		return hs
	}
	return Defaults(cmd.Keys)
}

// Format is formatHotkey off macOS: the modifiers, then the key, joined by
// " + ".
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

// EffectiveLabel is a command's first hotkey formatted, "" for none (the
// command palette's hint, HotkeyManager.printHotkeyForCommand).
func EffectiveLabel(cmd actionsapi.Command) string {
	if hs := Effective(cmd); len(hs) > 0 {
		return Format(hs[0])
	}
	return ""
}

// Conflicts are the other commands that a hotkey of cmd's also triggers
// (getHotkeyConflicts).
func Conflicts(cmd actionsapi.Command, h Hotkey) []actionsapi.Command {
	want, ok := signature(h)
	if !ok {
		return nil
	}
	var out []actionsapi.Command
	for _, other := range actionsapi.List() {
		if other.ID == cmd.ID {
			continue
		}
		for _, oh := range Effective(other) {
			if b, ok := signature(oh); ok && b == want {
				out = append(out, other)
				break
			}
		}
	}
	return out
}

// signature is hotkeySignature: the binding, modifiers in any order.
func signature(h Hotkey) (Binding, bool) { return h.binding() }
