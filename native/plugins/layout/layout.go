// Package layout is the layout UI plugin (dsh's ui-layout): it arranges
// the window — attention's ribbon, the left and right docks with their
// panels, the center (the workspace.center slot), the status bar and the
// overlays — and keeps the docks and the panels' states across runs.
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

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/layoutapi"
	"github.com/cunninghamcard-bit/attention/native/settingsapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
)

// ID is the plugin's name.
const ID = "layout"

var (
	themesMu sync.Mutex
	themes   = map[bool]*ui.Theme{}

	// Plugin arranges the window while loaded.
	Plugin = rutis.Define(rutis.Plugin[struct{}]{
		Name:   ID,
		Inject: []string{"shell", "actions"},
		Apply: func(rctx *rutis.Ctx, _ struct{}) error {
			l := New()
			saver := persist.New(paths.LayoutPath(), func() any { return l.Snapshot() })
			l.SaveSoon = saver.Soon
			if s, ok := load(); ok {
				shellapi.Update(func() { l.Restore(s) })
			}
			rctx.On(fscontract.WatchErrorEvent, func(_ context.Context, args ...any) (any, error) {
				if len(args) > 0 {
					msg := fmt.Sprint(args[0])
					shellapi.Update(func() { l.notice = msg })
				}
				return nil, nil
			})
			off := Register(l)
			rctx.Effect(func(ctx context.Context) error {
				off()
				saver.Final(ctx)
				return nil
			})
			return nil
		},
	})
)

// state is what the layout keeps across runs. Its fields have the names
// the workspace's session gave them, which it is read from once.
type state struct {
	PanelOpen  bool    `json:"panelOpen"`
	LeftWidth  float32 `json:"leftWidth"`
	LeftPanel  string  `json:"leftPanel,omitempty"`
	RightOpen  bool    `json:"rightOpen"`
	RightWidth float32 `json:"rightWidth,omitempty"`
	RightPanel string  `json:"rightPanel,omitempty"`
	// PanelStates are the panels', overlays' and palette sources' own
	// states by ID.
	PanelStates map[string]json.RawMessage `json:"panelStates,omitempty"`
}

// load reads the last run's state: the layout's file, else the docks the
// workspace's session kept before there was a layout.
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
		old.RightOpen = true // a session from before the file tree moved right
	}
	// The command palette's recent commands, from before its source kept
	// them.
	if _, ok := old.PanelStates["command-palette"]; !ok && len(old.RecentCommands) > 0 {
		if old.PanelStates == nil {
			old.PanelStates = map[string]json.RawMessage{}
		}
		old.PanelStates["command-palette"], _ = json.Marshal(old.RecentCommands)
	}
	return old.state, true
}

// Layout is the window's arrangement. Every field is read and written on
// the main thread only.
type Layout struct {
	leftOpen, rightOpen   bool
	leftWidth, rightWidth float32
	leftPanel, rightPanel string // the docks' shown panels
	reveals               map[string]int
	// saved are states from the last run not handed over yet; restored
	// the contributions that got theirs (or had none).
	saved    map[string]json.RawMessage
	restored map[string]bool
	seenLeft float32 // the width last saved, to notice a divider drag
	notice   string  // a window-wide message, as a watch error

	// SaveSoon notes a change worth saving; IsDark is mygo's; both
	// replaceable in tests.
	SaveSoon func()
	IsDark   func() bool
}

// New is the first run's layout: both docks open (the file tree's on the
// right, as Zed's project panel).
func New() *Layout {
	return &Layout{leftOpen: true, rightOpen: true, leftWidth: 260, rightWidth: 260,
		reveals: map[string]int{}, restored: map[string]bool{}, IsDark: mygo.Theme.IsDark}
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

// Snapshot is the state to save: the registered contributions' states,
// and the saved ones of those not restored yet.
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
	for _, d := range []slotsapi.Dock{slotsapi.Left, slotsapi.Right} {
		for _, p := range slotsapi.Panels(d) {
			keep(p.ID, p.State)
		}
	}
	for _, o := range slotsapi.Overlays() {
		keep(o.ID, o.State)
	}
	for _, src := range slotsapi.PaletteSources() {
		keep(src.ID, src.State)
	}
	if len(out) > 0 {
		s.PanelStates = out
	}
	return s
}

// Open reports whether a dock is open (layoutapi.API).
func (l *Layout) Open(d slotsapi.Dock) bool {
	if d == slotsapi.Right {
		return l.rightOpen
	}
	return l.leftOpen
}

// Toggle opens or closes a dock (layoutapi.API).
func (l *Layout) Toggle(d slotsapi.Dock) {
	if d == slotsapi.Right {
		l.rightOpen = !l.rightOpen
	} else {
		l.leftOpen = !l.leftOpen
	}
	l.changed()
}

// RevealPanel opens the dock holding the panel and shows it; its view sees
// the reveal (PanelProps.Reveal) and focuses its input (layoutapi.API).
func (l *Layout) RevealPanel(id string) {
	for _, d := range []slotsapi.Dock{slotsapi.Left, slotsapi.Right} {
		for _, p := range slotsapi.Panels(d) {
			if p.ID != id {
				continue
			}
			if d == slotsapi.Left {
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
func (l *Layout) ShownPanel(d slotsapi.Dock) string {
	want := l.leftPanel
	if d == slotsapi.Right {
		want = l.rightPanel
	}
	if p := shownPanel(slotsapi.Panels(d), want); p != nil {
		return p.ID
	}
	return ""
}

// RibbonShown is attention's showRibbon (layoutapi.API), true by default.
func (l *Layout) RibbonShown() bool {
	show := true
	settingsapi.Get(settingsapi.Appearance, "showRibbon", &show)
	return show
}

// View is the window's root (RFC §5.8: it reads state, never the disk):
// the ribbon, the left dock, the center, the right dock, over the status
// bar; the overlays below Order zero before it all, the rest after.
func (l *Layout) View(c *ui.Context) {
	c.SetTheme(themeFor(l.dark()))
	t := c.Theme()
	overlays := slotsapi.Overlays()
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
						if view := slotsapi.Center(); view != nil {
							view(c)
						}
					})
					if l.rightOpen {
						l.dock(c, slotsapi.Right)
					}
				})
			}
			if l.leftOpen {
				ui.Split(c, &l.leftWidth, func() { l.dock(c, slotsapi.Left) }, middle).Grow(1)
			} else {
				middle()
			}
		})
		l.statusBar(c)
	})
	for _, src := range slotsapi.PaletteSources() {
		l.restore(src.ID, src.Restore)
	}
	for _, o := range overlays {
		if o.Order >= 0 {
			l.restore(o.ID, o.Restore)
			o.View(c)
		}
	}
	// Dragging a divider changes the width during the build: save it.
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

// restore hands a contribution its saved state once, before its first
// draw.
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

// dark is the base color scheme: attention's theme, "moonstone" light,
// "obsidian" dark, else the system's.
func (l *Layout) dark() bool {
	var theme string
	settingsapi.Get(settingsapi.Appearance, "theme", &theme)
	switch theme {
	case "moonstone":
		return false
	case "obsidian":
		return true
	}
	return l.IsDark()
}

// appearance is the Appearance tab (AppearanceSettingTab): the base color
// scheme, then the Interface group. Accent color, fonts, zoom, themes and
// CSS snippets are not ported.
func (l *Layout) appearance(c *ui.Context) {
	// The theme group (AppearanceSettingTab.renderThemeSettings).
	omgui.SettingsSection(c, "", func() {
		l.colorScheme(c)
	})
	// The Interface group (renderInterfaceSettings).
	omgui.SettingsSection(c, "Interface", func() {
		l.ribbonRow(c)
	})
}

// colorScheme is Base color scheme.
func (l *Layout) colorScheme(c *ui.Context) {
	omgui.PreferenceRow(c, "Base color scheme", "Choose the color scheme used by the app.", func() {
		theme := "system"
		settingsapi.Get(settingsapi.Appearance, "theme", &theme)
		v := theme
		omgui.Select(c, omgui.SelectProps{Key: "appearance", Value: &v, Width: 160, Options: []omgui.SelectOption{
			{Value: "system", Label: "Adapt to system"}, {Value: "moonstone", Label: "Light"}, {Value: "obsidian", Label: "Dark"},
		}})
		if v != theme {
			settingsapi.Set(settingsapi.Appearance, "theme", v)
		}
	})
}

// ribbonRow is the Interface group's Show ribbon.
func (l *Layout) ribbonRow(c *ui.Context) {
	omgui.PreferenceRow(c, "Show ribbon", "Display the ribbon on the left side of the window.", func() {
		show := l.RibbonShown()
		on := show
		ui.Switch(c, &on)
		if on != show {
			settingsapi.Set(settingsapi.Appearance, "showRibbon", on)
		}
	})
}

// ribbon is attention's side ribbon: the left dock's toggle atop it
// (updateSidebarTogglePlacement, with the ribbon shown), then the
// registered actions.
func (l *Layout) ribbon(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Width(40).FillHeight().PaddingY(8).Gap(4).AlignItems(ui.Center).
		Background(t.Surface).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Children(func() {
		layoutapi.ToggleButton(c, slotsapi.Left)
		for _, r := range slotsapi.Ribbon() {
			// No Key on the element: it rekeys the button and loses OnClick.
			omgui.Button(c, omgui.ButtonProps{Label: r.Title, Icon: r.Icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall, OnClick: r.Run}).
				Tooltip(r.Title)
		}
	})
}

// dock is a sidebar: a header with one icon per panel, then the shown
// panel (attention's sidebar tab headers). The right dock's toggle sits at
// the start of its header, nearest the center.
func (l *Layout) dock(c *ui.Context, d slotsapi.Dock) {
	t := c.Theme()
	panels := slotsapi.Panels(d)
	col := ui.Column(c).Fill().Background(t.Surface)
	if d == slotsapi.Left {
		col.BorderWidth(0, 1, 0, 0)
	} else {
		col.Width(l.rightWidth).Shrink(0).BorderWidth(0, 0, 0, 1)
	}
	col.BorderColor(t.Border).Children(func() {
		want := l.leftPanel
		if d == slotsapi.Right {
			want = l.rightPanel
		}
		shown := shownPanel(panels, want)
		ui.Row(c).Height(38).Shrink(0).PaddingX(6).Gap(2).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
			if d == slotsapi.Right {
				layoutapi.ToggleButton(c, slotsapi.Right)
			}
			for i := range panels {
				p := panels[i]
				color := t.TextMuted
				if shown != nil && shown.ID == p.ID {
					color = t.Text
				}
				b := omgui.Button(c, omgui.ButtonProps{Label: p.Title, Icon: p.Icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall, IconColor: color}).
					Key("panel:" + p.ID).Checked(shown != nil && shown.ID == p.ID).Tooltip(p.Title)
				if b.Clicked() {
					l.RevealPanel(p.ID)
				}
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
			shown.View(c, slotsapi.PanelProps{Reveal: l.reveals[shown.ID]})
		})
	})
}

// statusBar draws the status items, the left ones, a watch error's icon,
// then the right ones.
func (l *Layout) statusBar(c *ui.Context) {
	t := c.Theme()
	ui.Row(c).Height(26).FillWidth().PaddingX(10).Gap(14).AlignItems(ui.Center).
		Background(t.Surface).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Children(func() {
		for _, s := range slotsapi.Status(false) {
			s.View(c)
		}
		if l.notice != "" {
			ui.Icon(c, lucide.TriangleAlert()).Size(12, 12).TextColor(t.Warning).Tooltip(l.notice)
		}
		ui.Box(c).Grow(1)
		for _, s := range slotsapi.Status(true) {
			s.View(c)
		}
	})
}

// commands are the docks' toggles.
func (l *Layout) commands() []actionsapi.Command {
	cmd := func(id, title, keys string, fn func()) actionsapi.Command {
		return actionsapi.Command{ID: id, Title: title, Keys: keys, Main: fn, Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			return shellapi.OnMain(ctx, func() (string, error) { fn(); return "", nil })
		}}
	}
	return []actionsapi.Command{
		cmd("app:toggle-left-sidebar", "Toggle left sidebar", "Ctrl B", func() { l.Toggle(slotsapi.Left) }),
		cmd("app:toggle-right-sidebar", "Toggle right sidebar", "Ctrl Alt B", func() { l.Toggle(slotsapi.Right) }),
	}
}

// Register makes l the window's root, the layout API and its commands
// until off is called.
func Register(l *Layout) (off func()) {
	offs := []func(){shellapi.SetRoot(l.View), layoutapi.Set(l),
		// AppearanceSettingTab.
		slotsapi.RegisterSettingsSection(slotsapi.SettingsSection{ID: "appearance", Title: "Appearance", Icon: lucide.Palette(), Order: 20,
			Keywords: []string{"Base color scheme", "Interface", "Show ribbon"}, View: l.appearance}),
	}
	for _, cmd := range l.commands() {
		offs = append(offs, actionsapi.Register(cmd))
	}
	return func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
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

// shownPanel is a dock's shown panel: the chosen one while it is
// registered, else the first.
func shownPanel(panels []slotsapi.Panel, want string) *slotsapi.Panel {
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
