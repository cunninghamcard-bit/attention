// Package layout is the layout UI plugin (dsh's ui-layout).
package layout

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention-ui/theme"
	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
)

// ID is the plugin's name.
const ID = "layout"

var (
	themesMu sync.Mutex
	themes   = map[bool]*ui.Theme{}

	// Plugin arranges the window while loaded.
	Plugin = rutis.Define(rutis.Plugin[struct{}]{
		Name:   ID,
		Inject: []string{"shell", "slots", "actions", "settings"},
		Apply: func(rctx *rutis.Ctx, _ struct{}) error {
			var sh *shell.Shell
			var sl *slots.Registry
			var act *actions.Service
			var set *settings.Settings
			if err := rctx.Use("shell", &sh); err != nil {
				return err
			}
			if err := rctx.Use("slots", &sl); err != nil {
				return err
			}
			if err := rctx.Use("actions", &act); err != nil {
				return err
			}
			if err := rctx.Use("settings", &set); err != nil {
				return err
			}
			l := New(sh, sl, set)
			saver := persist.New(sh, paths.LayoutPath(), func() any { return l.Snapshot() })
			l.SaveSoon = saver.Soon
			if s, ok := load(); ok {
				sh.Update(func() { l.Restore(s) })
			}
			rctx.On(fsplugin.WatchErrorEvent, func(_ context.Context, args ...any) (any, error) {
				if len(args) > 0 {
					msg := fmt.Sprint(args[0])
					sh.Update(func() { l.notice = msg })
				}
				return nil, nil
			})
			off := Register(l, sh, sl, act)
			rctx.Provide("layout", l)
			rctx.Effect(func(ctx context.Context) error {
				off()
				saver.Final(ctx)
				return nil
			})
			return nil
		},
	})
)

type state struct {
	PanelOpen   bool                       `json:"panelOpen"`
	LeftWidth   float32                    `json:"leftWidth"`
	LeftPanel   string                     `json:"leftPanel,omitempty"`
	RightOpen   bool                       `json:"rightOpen"`
	RightWidth  float32                    `json:"rightWidth,omitempty"`
	RightPanel  string                     `json:"rightPanel,omitempty"`
	PanelStates map[string]json.RawMessage `json:"panelStates,omitempty"`
}

// Layout is the window's arrangement.
type Layout struct {
	sh                    *shell.Shell
	slots                 *slots.Registry
	settings              *settings.Settings
	leftOpen, rightOpen   bool
	leftWidth, rightWidth float32
	leftPanel, rightPanel string
	reveals               map[string]int
	saved                 map[string]json.RawMessage
	restored              map[string]bool
	seenLeft              float32
	notice                string

	SaveSoon func()
	IsDark   func() bool
}

// New is the first run's layout: both docks open.
func New(sh *shell.Shell, sl *slots.Registry, set *settings.Settings) *Layout {
	return &Layout{
		sh: sh, slots: sl, settings: set,
		leftOpen: true, rightOpen: true, leftWidth: 260, rightWidth: 260,
		reveals: map[string]int{}, restored: map[string]bool{}, IsDark: mygo.Theme.IsDark,
	}
}

// Restore applies a saved state.
func (l *Layout) Restore(s state) {
	if s.LeftWidth >= 120 {
		l.leftWidth = s.LeftWidth
	}
	if s.RightWidth >= 120 {
		l.rightWidth = s.RightWidth
	}
	l.leftOpen, l.rightOpen = s.PanelOpen, s.RightOpen
	l.leftPanel, l.rightPanel = s.LeftPanel, s.RightPanel
	l.saved, l.restored = s.PanelStates, map[string]bool{}
}

// Snapshot is the state to save.
func (l *Layout) Snapshot() state {
	s := state{PanelOpen: l.leftOpen, LeftWidth: l.leftWidth, LeftPanel: l.leftPanel,
		RightOpen: l.rightOpen, RightWidth: l.rightWidth, RightPanel: l.rightPanel}
	out := map[string]json.RawMessage{}
	for id, st := range l.saved {
		out[id] = st
	}
	keep := func(id string, st func() json.RawMessage) {
		if st != nil && l.restored[id] {
			out[id] = st()
		}
	}
	for _, d := range []slots.Dock{slots.Left, slots.Right} {
		for _, p := range l.slots.Panels(d) {
			keep(p.ID, p.State)
		}
	}
	for _, o := range l.slots.Overlays() {
		keep(o.ID, o.State)
	}
	for _, src := range l.slots.PaletteSources() {
		keep(src.ID, src.State)
	}
	if len(out) > 0 {
		s.PanelStates = out
	}
	return s
}

// Open reports whether a dock is open.
func (l *Layout) Open(d slots.Dock) bool {
	if l == nil {
		return false
	}
	if d == slots.Right {
		return l.rightOpen
	}
	return l.leftOpen
}

// Toggle opens or closes a dock.
func (l *Layout) Toggle(d slots.Dock) {
	if l == nil {
		return
	}
	if d == slots.Right {
		l.rightOpen = !l.rightOpen
	} else {
		l.leftOpen = !l.leftOpen
	}
	l.changed()
}

// RevealPanel opens the dock holding the panel and shows it.
func (l *Layout) RevealPanel(id string) {
	if l == nil {
		return
	}
	for _, d := range []slots.Dock{slots.Left, slots.Right} {
		for _, p := range l.slots.Panels(d) {
			if p.ID != id {
				continue
			}
			if d == slots.Left {
				l.leftOpen, l.leftPanel = true, id
			} else {
				l.rightOpen, l.rightPanel = true, id
			}
			l.reveals[id]++
			l.changed()
			return
		}
	}
}

// ShownPanel is the ID of a dock's shown panel, "" for none.
func (l *Layout) ShownPanel(d slots.Dock) string {
	if l == nil {
		return ""
	}
	want := l.leftPanel
	if d == slots.Right {
		want = l.rightPanel
	}
	if p := shownPanel(l.slots.Panels(d), want); p != nil {
		return p.ID
	}
	return ""
}

// RibbonShown is attention's showRibbon, true by default.
func (l *Layout) RibbonShown() bool {
	show := true
	if l != nil {
		l.settings.Get(settings.Appearance, "showRibbon", &show)
	}
	return show
}

// ToggleButton draws a dock's toggle button.
func (l *Layout) ToggleButton(c *ui.Context, d slots.Dock) {
	if l == nil {
		return
	}
	icon := lucide.PanelLeft()
	if d == slots.Right {
		icon = lucide.PanelRight()
	}
	tip := "Expand"
	if l.Open(d) {
		tip = "Collapse"
	}
	omgui.Button(c, omgui.ButtonProps{Label: tip, Icon: icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
		OnClick: func() { l.Toggle(d) }}).Tooltip(tip)
}

// View is the window's root.
func (l *Layout) View(c *ui.Context) {
	c.SetTheme(themeFor(l.dark()))
	t := c.Theme()
	overlays := l.slots.Overlays()
	for _, o := range overlays {
		if o.Order < 0 {
			l.restore(o.ID, o.Restore)
			o.View(c)
		}
	}
	ui.Column(c).Fill().Background(t.Background).Children(func() {
		ui.Row(c).Grow(1).FillWidth().AlignItems(ui.Stretch).Children(func() {
			if l.RibbonShown() {
				l.ribbon(c)
			}
			middle := func() {
				ui.Row(c).Grow(1).Fill().AlignItems(ui.Stretch).Children(func() {
					ui.Column(c).Grow(1).Fill().Children(func() {
						if view := l.slots.Center(); view != nil {
							view(c)
						}
					})
					if l.rightOpen {
						l.dock(c, slots.Right)
					}
				})
			}
			if l.leftOpen {
				ui.Split(c, &l.leftWidth, func() { l.dock(c, slots.Left) }, middle).Grow(1)
			} else {
				middle()
			}
		})
		l.statusBar(c)
	})
	for _, src := range l.slots.PaletteSources() {
		l.restore(src.ID, src.Restore)
	}
	for _, o := range overlays {
		if o.Order >= 0 {
			l.restore(o.ID, o.Restore)
			o.View(c)
		}
	}
	if l.leftWidth != l.seenLeft {
		l.seenLeft = l.leftWidth
		l.changed()
	}
}

func (l *Layout) changed() {
	if l.SaveSoon != nil {
		l.SaveSoon()
	}
}

func (l *Layout) restore(id string, fn func(json.RawMessage)) {
	if l.restored[id] {
		return
	}
	l.restored[id] = true
	if st, ok := l.saved[id]; ok {
		delete(l.saved, id)
		if fn != nil {
			fn(st)
		}
	}
}

func (l *Layout) dark() bool {
	var themeName string
	l.settings.Get(settings.Appearance, "theme", &themeName)
	switch themeName {
	case "moonstone":
		return false
	case "obsidian":
		return true
	}
	return l.IsDark()
}

func (l *Layout) appearance(c *ui.Context) {
	omgui.SettingsSection(c, "", func() {
		l.colorScheme(c)
	})
	omgui.SettingsSection(c, "Interface", func() {
		l.ribbonRow(c)
	})
}

func (l *Layout) colorScheme(c *ui.Context) {
	omgui.PreferenceRow(c, "Base color scheme", "Choose the color scheme used by the app.", func() {
		themeName := "system"
		l.settings.Get(settings.Appearance, "theme", &themeName)
		v := themeName
		omgui.Select(c, omgui.SelectProps{Key: "appearance", Value: &v, Width: 160, Options: []omgui.SelectOption{
			{Value: "system", Label: "Adapt to system"}, {Value: "moonstone", Label: "Light"}, {Value: "obsidian", Label: "Dark"},
		}})
		if v != themeName {
			l.settings.Set(settings.Appearance, "theme", v)
		}
	})
}

func (l *Layout) ribbonRow(c *ui.Context) {
	omgui.PreferenceRow(c, "Show ribbon", "Display the ribbon on the left side of the window.", func() {
		show := l.RibbonShown()
		on := show
		ui.Switch(c, &on)
		if on != show {
			l.settings.Set(settings.Appearance, "showRibbon", on)
		}
	})
}

func (l *Layout) ribbon(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Width(40).FillHeight().PaddingY(8).Gap(4).AlignItems(ui.Center).
		Background(t.Surface).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Children(func() {
		l.ToggleButton(c, slots.Left)
		for _, r := range l.slots.Ribbon() {
			omgui.Button(c, omgui.ButtonProps{Label: r.Title, Icon: r.Icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall, OnClick: r.Run}).
				Tooltip(r.Title)
		}
	})
}

func (l *Layout) dock(c *ui.Context, d slots.Dock) {
	t := c.Theme()
	panels := l.slots.Panels(d)
	col := ui.Column(c).Fill().Background(t.Surface)
	if d == slots.Left {
		col.BorderWidth(0, 1, 0, 0)
	} else {
		col.Width(l.rightWidth).Shrink(0).BorderWidth(0, 0, 0, 1)
	}
	col.BorderColor(t.Border).Children(func() {
		want := l.leftPanel
		if d == slots.Right {
			want = l.rightPanel
		}
		shown := shownPanel(panels, want)
		ui.Row(c).Height(38).Shrink(0).PaddingX(6).Gap(2).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
			if d == slots.Right {
				l.ToggleButton(c, slots.Right)
			}
			for i := range panels {
				p := panels[i]
				color := t.TextMuted
				if shown != nil && shown.ID == p.ID {
					color = t.Text
				}
				omgui.Button(c, omgui.ButtonProps{Label: p.Title, Icon: p.Icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
					IconColor: color, OnClick: func() { l.RevealPanel(p.ID) }}).
					Checked(shown != nil && shown.ID == p.ID).Tooltip(p.Title)
			}
		})
		if shown == nil {
			ui.Column(c).Grow(1).Fill().Center().Children(func() {
				ui.Text(c, "No panels").TextColor(t.TextMuted)
			})
			return
		}
		l.restore(shown.ID, shown.Restore)
		ui.Column(c).Key("dock:" + shown.ID).Grow(1).FillWidth().MinHeight(0).Children(func() {
			shown.View(c, slots.PanelProps{Reveal: l.reveals[shown.ID]})
		})
	})
}

func (l *Layout) statusBar(c *ui.Context) {
	t := c.Theme()
	ui.Row(c).Height(26).FillWidth().PaddingX(10).Gap(14).AlignItems(ui.Center).
		Background(t.Surface).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Children(func() {
		for _, s := range l.slots.Status(false) {
			s.View(c)
		}
		if l.notice != "" {
			ui.Icon(c, lucide.TriangleAlert()).Size(12, 12).TextColor(t.Warning).Tooltip(l.notice)
		}
		ui.Box(c).Grow(1)
		for _, s := range l.slots.Status(true) {
			s.View(c)
		}
	})
}

func (l *Layout) commands(sh *shell.Shell) []actions.Command {
	cmd := func(id, title, keys string, fn func()) actions.Command {
		return actions.Command{ID: id, Title: title, Keys: keys, Main: fn, Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, sh, func() (string, error) { fn(); return "", nil })
		}}
	}
	return []actions.Command{
		cmd("app:toggle-left-sidebar", "Toggle left sidebar", "Ctrl B", func() { l.Toggle(slots.Left) }),
		cmd("app:toggle-right-sidebar", "Toggle right sidebar", "Ctrl Alt B", func() { l.Toggle(slots.Right) }),
	}
}

// Register makes l the window's root and registers its commands until off is called.
func Register(l *Layout, sh *shell.Shell, sl *slots.Registry, act *actions.Service) (off func()) {
	offs := []func(){
		sh.SetRoot(l.View),
		sl.RegisterSettingsSection(slots.SettingsSection{ID: "appearance", Title: "Appearance", Icon: lucide.Palette(), Order: 20,
			Keywords: []string{"Base color scheme", "Interface", "Show ribbon"}, View: l.appearance}),
	}
	for _, cmd := range l.commands(sh) {
		offs = append(offs, act.Add(cmd))
	}
	return func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

func load() (state, bool) {
	var s state
	if persist.Load(paths.LayoutPath(), &s) {
		return s, true
	}
	var old struct {
		state
		Main           json.RawMessage `json:"main"`
		RecentCommands []string        `json:"recentCommands"`
	}
	if !persist.Load(paths.SessionPath(), &old) {
		return s, false
	}
	if old.Main == nil {
		old.RightOpen = true
	}
	if _, ok := old.PanelStates["command-palette"]; !ok && len(old.RecentCommands) > 0 {
		if old.PanelStates == nil {
			old.PanelStates = map[string]json.RawMessage{}
		}
		old.PanelStates["command-palette"], _ = json.Marshal(old.RecentCommands)
	}
	return old.state, true
}

func themeFor(dark bool) *ui.Theme {
	themesMu.Lock()
	defer themesMu.Unlock()
	t, ok := themes[dark]
	if !ok {
		t = theme.For(dark, "default")
		themes[dark] = t
	}
	return t
}

func shownPanel(panels []slots.Panel, want string) *slots.Panel {
	for i := range panels {
		if panels[i].ID == want {
			return &panels[i]
		}
	}
	if len(panels) > 0 {
		return &panels[0]
	}
	return nil
}
