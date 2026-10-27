// Package shortcuts is the shortcuts UI plugin (dsh's
// @deepseek-ai/dsh-client-shortcuts): it binds every command's Keys, so a
// feature plugin declares its shortcuts with its commands and none is
// wired in a view. It draws no window chrome: an overlay reads the keys
// each frame, and its Hotkeys settings section lists them.
//
// TODO: user overrides of the default bindings, as dsh's keybindings file.
package shortcuts

import (
	"context"
	"strings"
	"sync"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
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
	for i, k := range []ui.Key{ui.Key0, ui.Key1, ui.Key2, ui.Key3, ui.Key4, ui.Key5, ui.Key6, ui.Key7, ui.Key8, ui.Key9} {
		keyNames[string(rune('0'+i))] = k
	}
	letters := []ui.Key{ui.KeyA, ui.KeyB, ui.KeyC, ui.KeyD, ui.KeyE, ui.KeyF, ui.KeyG, ui.KeyH, ui.KeyI, ui.KeyJ, ui.KeyK, ui.KeyL, ui.KeyM,
		ui.KeyN, ui.KeyO, ui.KeyP, ui.KeyQ, ui.KeyR, ui.KeyS, ui.KeyT, ui.KeyU, ui.KeyV, ui.KeyW, ui.KeyX, ui.KeyY, ui.KeyZ}
	for i, k := range letters {
		keyNames[string(rune('A'+i))] = k
	}
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

// Label is the first of a command's Keys as the palette shows it.
func Label(keys string) string {
	first, _, _ := strings.Cut(keys, ",")
	return display(strings.TrimSpace(first))
}

// display is a combination as shown: Control as Ctrl, Comma as ",".
func display(combo string) string {
	return strings.NewReplacer("Control", "Ctrl", "Comma", ",").Replace(combo)
}

// Shortcuts binds the registered commands' keys.
type Shortcuts struct {
	ctx    context.Context
	mu     sync.Mutex
	parsed map[string][]Binding // by Keys
	filter string               // the Hotkeys section's, main thread only
}

// New binds keys for commands whose Run runs under ctx.
func New(ctx context.Context) *Shortcuts {
	return &Shortcuts{ctx: ctx, parsed: map[string][]Binding{}}
}

func (s *Shortcuts) bindings(keys string) []Binding {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.parsed[keys]
	if !ok {
		b = Parse(keys)
		s.parsed[keys] = b
	}
	return b
}

// View runs the command of every combination pressed this frame: Main on
// the main thread, else Run on a goroutine.
func (s *Shortcuts) View(c *ui.Context) {
	for _, cmd := range actionsapi.List() {
		if cmd.Keys == "" || cmd.Main == nil && cmd.Run == nil {
			continue
		}
		for _, b := range s.bindings(cmd.Keys) {
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

// Hotkeys is the Hotkeys settings section (attention's Hotkeys tab, dsh's
// ui-shortcuts reference): every titled command and its keys, filtered by
// name or key. Read-only until overrides exist.
func (s *Shortcuts) Hotkeys(c *ui.Context) {
	t := c.Theme()
	omgui.Field(c, &s.filter, "Search commands...", false).FillWidth()
	q := strings.ToLower(strings.TrimSpace(s.filter))
	omgui.SettingsSection(c, "", func() {
		for _, cmd := range actionsapi.List() {
			if cmd.Title == "" {
				continue
			}
			if q != "" && !strings.Contains(strings.ToLower(cmd.Title), q) && !strings.Contains(strings.ToLower(display(cmd.Keys)), q) {
				continue
			}
			omgui.PreferenceRow(c, cmd.Title, cmd.ID, func() {
				if cmd.Keys == "" {
					ui.Text(c, "No hotkey").FontSize(12).TextColor(t.TextMuted)
					return
				}
				ui.Column(c).Gap(4).AlignItems(ui.End).Children(func() {
					for _, combo := range strings.Split(cmd.Keys, ",") {
						omgui.ShortcutCaps(c, strings.Fields(display(combo)))
					}
				})
			})
		}
	})
}

// Register binds keys and adds the Hotkeys section until off is called.
func Register(ctx context.Context) (off func()) {
	s := New(ctx)
	offOverlay := slotsapi.RegisterOverlay(slotsapi.Overlay{ID: ID, Order: -1000, View: s.View})
	offSection := slotsapi.RegisterSettingsSection(slotsapi.SettingsSection{ID: "hotkeys", Title: "Hotkeys", Icon: lucide.Keyboard(), Order: 50,
		Keywords: []string{"keyboard", "shortcuts"}, View: s.Hotkeys})
	return func() { offSection(); offOverlay() }
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
