// Package shortcuts is the shortcuts UI plugin (dsh's
// @deepseek-ai/dsh-client-shortcuts): it binds every command's Keys, so a
// feature plugin declares its shortcuts with its commands and none is
// wired in a view. An overlay reads the keys each frame; the keyboard
// shortcuts reference (dsh's ui-shortcuts) lists and edits them.
//
// The user's bindings override a command's defaults in hotkeys.json.
package shortcuts

import (
	"context"
	"strings"
	"sync"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/settingsapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
)

// ID is the plugin's name and its overlay's.
const ID = "shortcuts"

// Binding is one parsed key combination.
type Binding struct {
	Mods ui.Modifiers
	Key  ui.Key
}

var keyNames = map[string]ui.Key{
	"Enter": ui.KeyEnter, "Escape": ui.KeyEscape, "Backspace": ui.KeyBackspace, "Tab": ui.KeyTab,
	"Space": ui.KeySpace, "Delete": ui.KeyDelete, "Insert": ui.KeyInsert, "Home": ui.KeyHome, "End": ui.KeyEnd,
	"PageUp": ui.KeyPageUp, "PageDown": ui.KeyPageDown, "Left": ui.KeyLeft, "Right": ui.KeyRight,
	"Up": ui.KeyUp, "Down": ui.KeyDown, "-": ui.KeyMinus, "=": ui.KeyEqual, "Comma": ui.KeyComma, ".": ui.KeyPeriod,
	"/": ui.KeySlash, ";": ui.KeySemicolon, "'": ui.KeyQuote, "[": ui.KeyBracketLeft, "]": ui.KeyBracketRight,
	"\\": ui.KeyBackslash, "`": ui.KeyBackquote,
	"F1": ui.KeyF1, "F2": ui.KeyF2, "F3": ui.KeyF3, "F4": ui.KeyF4, "F5": ui.KeyF5, "F6": ui.KeyF6,
	"F7": ui.KeyF7, "F8": ui.KeyF8, "F9": ui.KeyF9, "F10": ui.KeyF10, "F11": ui.KeyF11, "F12": ui.KeyF12,
}

func init() {
	for name, k := range lettersAndDigits() {
		keyNames[name] = k
	}
}

// lettersAndDigits are the letter and digit keys by name, as both Keys and
// a Hotkey name them.
func lettersAndDigits() map[string]ui.Key {
	out := map[string]ui.Key{}
	for i, k := range []ui.Key{ui.Key0, ui.Key1, ui.Key2, ui.Key3, ui.Key4, ui.Key5, ui.Key6, ui.Key7, ui.Key8, ui.Key9} {
		out[string(rune('0'+i))] = k
	}
	letters := []ui.Key{ui.KeyA, ui.KeyB, ui.KeyC, ui.KeyD, ui.KeyE, ui.KeyF, ui.KeyG, ui.KeyH, ui.KeyI, ui.KeyJ, ui.KeyK, ui.KeyL, ui.KeyM,
		ui.KeyN, ui.KeyO, ui.KeyP, ui.KeyQ, ui.KeyR, ui.KeyS, ui.KeyT, ui.KeyU, ui.KeyV, ui.KeyW, ui.KeyX, ui.KeyY, ui.KeyZ}
	for i, k := range letters {
		out[string(rune('A'+i))] = k
	}
	return out
}

// Parse reads a command's Keys (see actionsapi.Command.Keys); a
// combination naming an unknown key or no key is left out.
func Parse(keys string) []Binding {
	var out []Binding
	for _, combo := range strings.Split(keys, ",") {
		var b Binding
		ok := false
		for _, part := range strings.Fields(combo) {
			switch part {
			case "Ctrl":
				b.Mods |= ui.Cmd
			case "Control":
				b.Mods |= ui.Ctrl
			case "Shift":
				b.Mods |= ui.Shift
			case "Alt":
				b.Mods |= ui.Alt
			default:
				b.Key, ok = keyNames[part]
			}
		}
		if ok {
			out = append(out, b)
		}
	}
	return out
}

// Shortcuts binds the registered commands' keys.
type Shortcuts struct {
	ctx    context.Context
	mu     sync.Mutex
	parsed map[string][]Binding // by Keys
	// effective are the commands' bindings by ID, for settings generation
	// gen.
	effective map[string][]Binding
	gen       int
	// The Hotkeys tab's, main thread only: its search, and the command
	// whose next combination it records ("" for none).
	filter    string
	recording string
}

// New binds keys for commands whose Run runs under ctx.
func New(ctx context.Context) *Shortcuts {
	return &Shortcuts{ctx: ctx, parsed: map[string][]Binding{}}
}

func (s *Shortcuts) defaults(keys string) []Binding {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.parsed[keys]
	if !ok {
		b = Parse(keys)
		s.parsed[keys] = b
	}
	return b
}

// bindings are cmd's effective combinations: hotkeys.json's, else its
// Keys; read again when the settings change.
func (s *Shortcuts) bindings(cmd actionsapi.Command) []Binding {
	if g := settingsapi.Generation(); g != s.gen || s.effective == nil {
		s.gen, s.effective = g, map[string][]Binding{}
	}
	if b, ok := s.effective[cmd.ID]; ok {
		return b
	}
	var out []Binding
	if !Overridden(cmd.ID) {
		out = s.defaults(cmd.Keys)
	} else {
		for _, h := range Effective(cmd) {
			if b, ok := h.binding(); ok {
				out = append(out, b)
			}
		}
	}
	s.effective[cmd.ID] = out
	return out
}

// recordMods are the modifier sets a recorded combination may hold.
var recordMods = func() []ui.Modifiers {
	var out []ui.Modifiers
	for m := ui.Modifiers(0); m <= ui.Shift|ui.Ctrl|ui.Alt|ui.Super; m++ {
		if m&^(ui.Shift|ui.Ctrl|ui.Alt|ui.Super) == 0 {
			out = append(out, m)
		}
	}
	return out
}()

// record takes the combination pressed this frame for the recorded
// command (HotkeysSettingTab.recordHotkey): Escape cancels; any other
// joins the command's hotkeys, even one another command has.
func (s *Shortcuts) record(c *ui.Context) {
	if c.Shortcut(0, ui.KeyEscape) {
		s.recording = ""
		return
	}
	for _, m := range recordMods {
		for k := range hotkeyNames {
			if k == ui.KeyEscape && m == 0 || !c.Shortcut(m, k) {
				continue
			}
			cmd, ok := actionsapi.Lookup(s.recording)
			if !ok {
				s.recording = ""
				return
			}
			// recordHotkey: the combination joins the command's hotkeys.
			h := hotkeyOf(Binding{Mods: m, Key: k})
			settingsapi.Set(settingsapi.Hotkeys, cmd.ID, append(Effective(cmd), h))
			s.recording = ""
			return
		}
	}
}

// View runs the command of every combination pressed this frame: Main on
// the main thread, else Run on a goroutine. A modal dialog open keeps the
// keys from it; the reference records in its own.
func (s *Shortcuts) View(c *ui.Context) {
	for _, cmd := range actionsapi.List() {
		if cmd.Main == nil && cmd.Run == nil {
			continue
		}
		for _, b := range s.bindings(cmd) {
			if !c.Shortcut(b.Mods, b.Key) {
				continue
			}
			if cmd.Main != nil {
				cmd.Main()
			} else {
				run := cmd.Run
				go func() { _, _ = run(s.ctx, actionsapi.Args{Params: map[string]string{}}) }()
			}
			break
		}
	}
}

// Register binds keys and adds the Hotkeys settings tab until off is
// called.
func Register(ctx context.Context) (off func()) {
	s := New(ctx)
	offs := []func(){
		slotsapi.RegisterOverlay(slotsapi.Overlay{ID: ID, Order: -1000, View: s.View}),
		slotsapi.RegisterSettingsSection(slotsapi.SettingsSection{ID: "hotkeys", Title: "Hotkeys", Icon: lucide.Keyboard(), Order: 30,
			Keywords: []string{"Search commands", "Add hotkey", "Restore default hotkeys"}, View: s.hotkeysTab}),
	}
	return func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

// Plugin binds the commands' keys while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		ctx, cancel := context.WithCancel(context.Background())
		off := Register(ctx)
		rctx.Effect(func(context.Context) error {
			off()
			cancel()
			return nil
		})
		return nil
	},
})
