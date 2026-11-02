// Package settings is the settings modal and configuration store plugin
// (RFC 0001 §5.7, apps/web/builtin/SettingsModal.ts, SettingsRenderer.ts).
package settings

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/cli"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
)

const (
	ID = "settings"

	App        = "app"
	Appearance = "appearance"
	Hotkeys    = "hotkeys"
)

// Plugin is the settings modal and store while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "slots", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var sh *shell.Shell
		var sl *slots.Registry
		var act *actions.Service
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		if err := rctx.Use("slots", &sl); err != nil {
			return err
		}
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		s, off := Register(sh, sl, act)
		s.Load(App, Appearance, Hotkeys)
		rctx.Provide("settings", s)
		rctx.Effect(func(ctx context.Context) error {
			off()
			s.Flush(ctx)
			return nil
		})
		return nil
	},
})

// Settings is the configuration store and modal state.
type Settings struct {
	sh     *shell.Shell
	slots  *slots.Registry
	mu     sync.Mutex
	files  map[string]map[string]json.RawMessage
	savers map[string]*persist.Saver
	gen    int
	open   bool
	query  string
	shown  string
}

// New creates an empty Settings store.
func New(sh *shell.Shell, sl *slots.Registry) *Settings {
	return &Settings{
		sh:     sh,
		slots:  sl,
		files:  map[string]map[string]json.RawMessage{},
		savers: map[string]*persist.Saver{},
		shown:  "general",
	}
}

// Register adds the modal, its General tab, its command and its ribbon icon.
func Register(sh *shell.Shell, sl *slots.Registry, act *actions.Service) (s *Settings, off func()) {
	s = New(sh, sl)
	offs := []func(){
		sl.RegisterOverlay(slots.Overlay{ID: ID, Order: 10, View: s.View}),
		sl.RegisterSettingsSection(slots.SettingsSection{ID: "general", Title: "General", Icon: lucide.SlidersHorizontal(), Order: 0,
			Keywords: []string{"Current version", "Configuration folder"}, View: general}),
		act.Add(actions.Command{ID: "app:open-settings", Title: "Open settings", Keys: "Ctrl Comma", Main: s.Toggle,
			Run: func(ctx context.Context, _ actions.Args) (string, error) {
				return shell.OnMain(ctx, sh, func() (string, error) { s.Open(""); return "", nil })
			}}),
		sl.RegisterRibbon(slots.RibbonItem{ID: ID, Title: "Settings", Icon: lucide.Settings(), Order: 100, Run: func() { s.Open("") }}),
	}
	return s, func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

// Generation changes whenever a value is set or a file loaded.
func (s *Settings) Generation() int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.gen
}

// Get reads key of file into v; false when it is unset or not v's type.
func (s *Settings) Get(file, key string, v any) bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	raw, ok := s.files[file][key]
	s.mu.Unlock()
	return ok && json.Unmarshal(raw, v) == nil
}

// Keys are file's keys and values.
func (s *Settings) Keys(file string) map[string]json.RawMessage {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]json.RawMessage, len(s.files[file]))
	for k, v := range s.files[file] {
		out[k] = v
	}
	return out
}

// Set sets key of file to v and saves the file soon.
func (s *Settings) Set(file, key string, v any) {
	if s == nil {
		return
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	s.mu.Lock()
	if s.files[file] == nil {
		s.files[file] = map[string]json.RawMessage{}
	}
	s.files[file][key] = raw
	s.gen++
	s.mu.Unlock()
	s.saver(file).Soon()
	s.sh.Invalidate()
}

// Unset removes key of file and saves the file soon.
func (s *Settings) Unset(file, key string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	delete(s.files[file], key)
	s.gen++
	s.mu.Unlock()
	s.saver(file).Soon()
	s.sh.Invalidate()
}

// Flush writes the files with pending saves now (on unload).
func (s *Settings) Flush(ctx context.Context) {
	if s == nil {
		return
	}
	s.mu.Lock()
	pending := s.savers
	s.savers = map[string]*persist.Saver{}
	s.mu.Unlock()
	for _, sv := range pending {
		sv.Final(ctx)
	}
}

// Load reads the files from disk off the main thread and installs them on it.
func (s *Settings) Load(names ...string) {
	if s == nil {
		return
	}
	read := map[string]map[string]json.RawMessage{}
	for _, f := range names {
		var m map[string]json.RawMessage
		if persist.Load(Path(f), &m) && m != nil {
			read[f] = m
		}
	}
	s.sh.Update(func() {
		s.mu.Lock()
		for f, m := range read {
			s.files[f] = m
		}
		s.gen++
		s.mu.Unlock()
		s.sh.Invalidate()
	})
}

// Open opens the modal on tab id, or on the last tab for "".
func (s *Settings) Open(id string) {
	s.open = true
	if id != "" {
		s.shown = id
	}
}

// Toggle opens or closes the modal.
func (s *Settings) Toggle() {
	if s.open {
		s.open = false
		return
	}
	s.Open("")
}

// View draws the modal while it is open.
func (s *Settings) View(c *ui.Context) {
	if !s.open {
		return
	}
	var options, core []slots.SettingsSection
	for _, sec := range s.slots.SettingsSections() {
		if !matches(sec, s.query) {
			continue
		}
		if sec.Group == slots.CorePlugins {
			core = append(core, sec)
		} else {
			options = append(options, sec)
		}
	}
	all := append(append([]slots.SettingsSection(nil), options...), core...)
	var cur *slots.SettingsSection
	for i := range all {
		if all[i].ID == s.shown {
			cur = &all[i]
		}
	}
	if cur == nil && len(all) > 0 {
		cur, s.shown = &all[0], all[0].ID
	}
	title := "Settings"
	if cur != nil {
		title = cur.Title
	}
	winW, winH := c.Size()
	w, h := min(winW*0.9, 900), min(winH*0.85, 700)
	omgui.Dialog(c, omgui.DialogProps{Open: &s.open, Key: ID, Title: title, Width: w, MaxHeight: h, Flush: true, Body: func(c *ui.Context) {
		if c.Shortcut(ui.Cmd, ui.KeyComma) {
			s.open = false
			return
		}
		s.body(c, options, core, cur, w, h)
	}})
}

func (s *Settings) saver(file string) *persist.Saver {
	s.mu.Lock()
	defer s.mu.Unlock()
	sv, ok := s.savers[file]
	if !ok {
		sv = persist.New(s.sh, Path(file), func() any { return s.Keys(file) })
		s.savers[file] = sv
	}
	return sv
}

func (s *Settings) body(c *ui.Context, options, core []slots.SettingsSection, cur *slots.SettingsSection, w, h float32) {
	t := c.Theme()
	ui.Row(c).FillWidth().Height(h).AlignItems(ui.Stretch).Background(t.Background).Children(func() {
		ui.Column(c).Width(min(max(w*0.25, 190), 230)).Shrink(0).FillHeight().Gap(8).
			Background(t.Surface).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Padding(12).Children(func() {
			omgui.SearchField(c, &s.query, "Search settings", false).Label("Search settings").FillWidth()
			ui.Scroll(c).Grow(1).FillWidth().Children(func() {
				ui.Column(c).FillWidth().Gap(2).Children(func() {
					s.group(c, "Options", options)
					s.group(c, "Core plugins", core)
				})
			})
		})
		ui.Scroll(c).Grow(1).Fill().Background(t.Background).Children(func() {
			ui.Column(c).FillWidth().Padding(28, 36, 36, 36).Gap(20).Children(func() {
				if cur == nil {
					ui.Text(c, "No settings match.").TextColor(t.TextMuted)
					return
				}
				cur.View(c)
			})
		})
	})
}

func (s *Settings) group(c *ui.Context, title string, secs []slots.SettingsSection) {
	if len(secs) == 0 {
		return
	}
	ui.Box(c).Padding(6, 8).Children(func() { omgui.SectionLabel(c, title) })
	for _, sec := range secs {
		id := sec.ID
		if omgui.SidebarItem(c, omgui.SidebarItemProps{Key: "settings:" + id, Label: sec.Title, Icon: sec.Icon, Selected: id == s.shown}).Clicked() {
			s.shown = id
		}
	}
}

// Path is a configuration file's path.
func Path(file string) string { return filepath.Join(paths.ConfigDir(), file+".json") }

func matches(sec slots.SettingsSection, query string) bool {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return true
	}
	for _, text := range append([]string{sec.Title, sec.ID}, sec.Keywords...) {
		if strings.Contains(strings.ToLower(text), q) {
			return true
		}
	}
	return false
}

func general(c *ui.Context) {
	omgui.SettingsSection(c, "App", func() {
		omgui.PreferenceRow(c, "Current version", cli.Version, nil)
		omgui.PreferenceRow(c, "Configuration folder", paths.ConfigDir(), func() {
			omgui.Button(c, omgui.ButtonProps{Label: "Open", Variant: omgui.ButtonSecondary, OnClick: func() {
				dir := paths.ConfigDir()
				go func() { _ = mygo.Shell.OpenPath(dir) }()
			}})
		})
	})
}
