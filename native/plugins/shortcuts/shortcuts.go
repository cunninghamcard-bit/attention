// Package shortcuts is the shortcuts UI plugin (dsh's
// @deepseek-ai/dsh-client-shortcuts).
package shortcuts

import (
	"context"
	"strings"
	"sync"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// ID is the plugin's name and its overlay's.
const ID = "shortcuts"

var (
	keyNames = func() map[string]ui.Key {
		m := map[string]ui.Key{
			"Enter": ui.KeyEnter, "Escape": ui.KeyEscape, "Backspace": ui.KeyBackspace, "Tab": ui.KeyTab,
			"Space": ui.KeySpace, "Delete": ui.KeyDelete, "Insert": ui.KeyInsert, "Home": ui.KeyHome, "End": ui.KeyEnd,
			"PageUp": ui.KeyPageUp, "PageDown": ui.KeyPageDown, "Left": ui.KeyLeft, "Right": ui.KeyRight,
			"Up": ui.KeyUp, "Down": ui.KeyDown, "-": ui.KeyMinus, "=": ui.KeyEqual, "Comma": ui.KeyComma, ".": ui.KeyPeriod,
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

	recordMods = func() []ui.Modifiers {
		var out []ui.Modifiers
		for m := ui.Modifiers(0); m <= ui.Shift|ui.Ctrl|ui.Alt|ui.Super; m++ {
			if m&^(ui.Shift|ui.Ctrl|ui.Alt|ui.Super) == 0 {
				out = append(out, m)
			}
		}
		return out
	}()

	// Plugin binds the commands' keys while loaded.
	Plugin = rutis.Define(rutis.Plugin[struct{}]{
		Name:   ID,
		Inject: []string{"slots", "actions", "settings"},
		Apply: func(rctx *rutis.Ctx, _ struct{}) error {
			var sl *slots.Registry
			var act *actions.Service
			var set *settings.Settings
			if err := rctx.Use("slots", &sl); err != nil {
				return err
			}
			if err := rctx.Use("actions", &act); err != nil {
				return err
			}
			if err := rctx.Use("settings", &set); err != nil {
				return err
			}
			ctx, cancel := context.WithCancel(context.Background())
			s, off := Register(ctx, sl, act, set)
			rctx.Provide("shortcuts", s)
			rctx.Effect(func(context.Context) error {
				off()
				cancel()
				return nil
			})
			return nil
		},
	})
)

// Binding is one parsed key combination.
type Binding struct {
	Mods ui.Modifiers
	Key  ui.Key
}

// Shortcuts binds the registered commands' keys.
type Shortcuts struct {
	ctx       context.Context
	actions   *actions.Service
	settings  *settings.Settings
	mu        sync.Mutex
	parsed    map[string][]Binding
	effective map[string][]Binding
	gen       int
	capture   bool
	filter    string
	recording string
}

// New binds keys for commands whose Run runs under ctx.
func New(ctx context.Context, act *actions.Service, set *settings.Settings) *Shortcuts {
	return &Shortcuts{ctx: ctx, actions: act, settings: set, parsed: map[string][]Binding{}}
}

// Register binds keys and adds the Hotkeys settings tab until off is called.
func Register(ctx context.Context, sl *slots.Registry, act *actions.Service, set *settings.Settings) (s *Shortcuts, off func()) {
	s = New(ctx, act, set)
	offs := []func(){
		sl.RegisterOverlay(slots.Overlay{ID: ID, Order: -1000, View: s.View}),
		sl.RegisterSettingsSection(slots.SettingsSection{ID: "hotkeys", Title: "Hotkeys", Icon: icon.Must("keyboard"), Order: 30,
			Keywords: []string{"Search commands", "Add hotkey", "Restore default hotkeys"}, View: s.hotkeysTab}),
	}
	return s, func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

// SetCapture says whether a key-capturing element (like a terminal) has focus for the frame.
func (s *Shortcuts) SetCapture(on bool) {
	if s != nil {
		s.capture = on
	}
}

// Captured reports whether the last frame built had key capture enabled.
func (s *Shortcuts) Captured() bool {
	if s == nil {
		return false
	}
	return s.capture
}

// View runs the command of every combination pressed this frame.
func (s *Shortcuts) View(c *ui.Context) {
	captured := s.Captured()
	s.SetCapture(false)
	cmds := s.actions.Commands()
	var taken map[Binding]bool
	if captured {
		taken = map[Binding]bool{}
		for _, cmd := range cmds {
			for _, b := range s.bindings(cmd) {
				taken[b] = true
			}
		}
	}
	for _, cmd := range cmds {
		if cmd.Main == nil && cmd.Run == nil {
			continue
		}
		for _, b := range s.bindings(cmd) {
			if captured {
				var ok bool
				if b, ok = inTerminal(b, taken); !ok {
					continue
				}
			}
			if !c.Shortcut(b.Mods, b.Key) {
				continue
			}
			if cmd.Main != nil {
				cmd.Main()
			} else {
				run := cmd.Run
				go func() { _, _ = run(s.ctx, actions.Args{Params: map[string]string{}}) }()
			}
			break
		}
	}
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

func (s *Shortcuts) bindings(cmd actions.Command) []Binding {
	if g := s.settings.Generation(); g != s.gen || s.effective == nil {
		s.gen, s.effective = g, map[string][]Binding{}
	}
	if b, ok := s.effective[cmd.ID]; ok {
		return b
	}
	var out []Binding
	if !s.Overridden(cmd.ID) {
		out = s.defaults(cmd.Keys)
	} else {
		for _, h := range s.Effective(cmd) {
			if b, ok := h.binding(); ok {
				out = append(out, b)
			}
		}
	}
	s.effective[cmd.ID] = out
	return out
}

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
			cmd := s.actions.Lookup(s.recording)
			if cmd == nil {
				s.recording = ""
				return
			}
			h := hotkeyOf(Binding{Mods: m, Key: k})
			s.settings.Set(settings.Hotkeys, cmd.ID, append(s.Effective(*cmd), h))
			s.recording = ""
			return
		}
	}
}

// Parse reads a command's Keys.
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

func inTerminal(b Binding, taken map[Binding]bool) (Binding, bool) {
	if !terminalKeeps(b) {
		return b, true
	}
	if b.Mods != ui.Ctrl || b.Key < ui.KeyA || b.Key > ui.KeyZ {
		return b, false
	}
	alt := Binding{Mods: ui.Ctrl | ui.Shift, Key: b.Key}
	if terminalKeeps(alt) || taken[alt] {
		return b, false
	}
	return alt, true
}

func terminalKeeps(b Binding) bool {
	switch b.Mods {
	case ui.Ctrl:
		switch b.Key {
		case ui.KeyBracketLeft, ui.KeyBracketRight, ui.KeyBackslash, ui.KeySpace, ui.KeyEqual, ui.KeyMinus, ui.Key0:
			return true
		}
		return b.Key >= ui.KeyA && b.Key <= ui.KeyZ
	case ui.Ctrl | ui.Shift:
		switch b.Key {
		case ui.KeyC, ui.KeyV, ui.KeyA, ui.KeyK, ui.KeyEqual:
			return true
		}
	}
	return false
}

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
