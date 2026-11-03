// Package layout is the layout UI plugin (dsh's ui-layout).
package layout

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/appearance"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// ID is the plugin's name.
const ID = "layout"

var (
	// Plugin arranges the window while loaded.
	Plugin = rutis.Define(rutis.Plugin[struct{}]{
		Name:   ID,
		Inject: []string{"shell", "slots", "actions", "appearance"},
		Apply: func(rctx *rutis.Ctx, _ struct{}) error {
			var sh *shell.Shell
			var sl *slots.Registry
			var act *actions.Service
			var app *appearance.Appearance
			if err := rctx.Use("shell", &sh); err != nil {
				return err
			}
			if err := rctx.Use("slots", &sl); err != nil {
				return err
			}
			if err := rctx.Use("actions", &act); err != nil {
				return err
			}
			if err := rctx.Use("appearance", &app); err != nil {
				return err
			}
			l := New(sh, sl, app)
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
	Collapsed   []string                   `json:"collapsed,omitempty"`
	PanelStates map[string]json.RawMessage `json:"panelStates,omitempty"`
}

// Layout is the window's arrangement (RFC 0003 §3): the sidebar, the
// content card, and the context column.
type Layout struct {
	sh                    *shell.Shell
	slots                 *slots.Registry
	app                   *appearance.Appearance
	act                   *actions.Service
	leftOpen, rightOpen   bool
	leftWidth, rightWidth float32
	leftPanel             string
	collapsed             map[string]bool
	reveals               map[string]int
	saved                 map[string]json.RawMessage
	restored              map[string]bool
	seenLeft              float32
	notice                string
	tinted                ui.Theme // the window's theme with the project's surface
	tintedTokens          aui.Tokens

	SaveSoon func()
}

// New is the first run's layout: the sidebar open, the context column
// closed.
func New(sh *shell.Shell, sl *slots.Registry, app *appearance.Appearance) *Layout {
	return &Layout{
		sh: sh, slots: sl, app: app,
		leftOpen: true, rightOpen: false, leftWidth: 248, rightWidth: 280,
		collapsed: map[string]bool{}, reveals: map[string]int{}, restored: map[string]bool{},
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
	l.leftOpen, l.rightOpen, l.leftPanel = s.PanelOpen, s.RightOpen, s.LeftPanel
	l.collapsed = map[string]bool{}
	for _, id := range s.Collapsed {
		l.collapsed[id] = true
	}
	l.saved, l.restored = s.PanelStates, map[string]bool{}
}

// Snapshot is the state to save.
func (l *Layout) Snapshot() state {
	s := state{PanelOpen: l.leftOpen, LeftWidth: l.leftWidth, LeftPanel: l.leftPanel,
		RightOpen: l.rightOpen, RightWidth: l.rightWidth}
	for id, shut := range l.collapsed {
		if shut {
			s.Collapsed = append(s.Collapsed, id)
		}
	}
	slices.Sort(s.Collapsed)
	out := maps.Clone(l.saved)
	if out == nil {
		out = map[string]json.RawMessage{}
	}
	keep := func(id string, st func() json.RawMessage) {
		if st != nil && l.restored[id] {
			out[id] = st()
		}
	}
	for _, d := range []slots.Dock{slots.Sidebar, slots.Context} {
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

// Open reports whether the sidebar or the context column is open.
func (l *Layout) Open(d slots.Dock) bool {
	if l == nil {
		return false
	}
	if d == slots.Context {
		return l.rightOpen
	}
	return l.leftOpen
}

// Toggle opens or closes the sidebar or the context column.
func (l *Layout) Toggle(d slots.Dock) {
	if l == nil {
		return
	}
	if d == slots.Context {
		l.rightOpen = !l.rightOpen
	} else {
		l.leftOpen = !l.leftOpen
	}
	l.changed()
}

// RevealPanel shows the panel: a sidebar panel becomes the shown one, a
// context section expands; either way its side opens.
func (l *Layout) RevealPanel(id string) {
	if l == nil {
		return
	}
	for _, d := range []slots.Dock{slots.Sidebar, slots.Context} {
		for _, p := range l.slots.Panels(d) {
			if p.ID != id {
				continue
			}
			if d == slots.Sidebar {
				l.leftOpen, l.leftPanel = true, id
			} else {
				l.rightOpen = true
				delete(l.collapsed, id)
			}
			l.reveals[id]++
			l.changed()
			return
		}
	}
}

// ShownPanel is the ID of the sidebar's shown panel, "" for none; the
// context column shows all of its panels.
func (l *Layout) ShownPanel(d slots.Dock) string {
	if l == nil || d != slots.Sidebar {
		return ""
	}
	if p := shownPanel(l.slots.Panels(d), l.leftPanel); p != nil {
		return p.ID
	}
	return ""
}

// LeftHeaderSpace is the room a header at the window's top-left leaves
// for the window controls.
func (l *Layout) LeftHeaderSpace(c *ui.Context) float32 {
	if left := c.TitleBar().Left; left > 0 {
		return max(left, 80)
	}
	return 0
}

// ToggleButton draws the sidebar's or the context column's toggle.
func (l *Layout) ToggleButton(c *ui.Context, d slots.Dock) {
	if l == nil {
		return
	}
	glyph := icon.Must("panel-left")
	if d == slots.Context {
		glyph = icon.Must("panel-right")
	}
	tip := "Expand"
	if l.Open(d) {
		tip = "Collapse"
	}
	aui.Tooltip(c, aui.Button(c, aui.ButtonProps{Label: tip, Icon: glyph, Variant: aui.ButtonGhost, Size: aui.ButtonIconSmall,
		OnClick: func() { l.Toggle(d) }}), tip)
}

// View is the window's root.
func (l *Layout) View(c *ui.Context) {
	base := l.app.UI()
	c.SetTheme(base)
	overlays := l.slots.Overlays()
	for _, o := range overlays {
		if o.Order < 0 {
			l.restore(o.ID, o.Restore)
			o.View(c)
		}
	}
	root := ui.Row(c).Fill().AlignItems(ui.Stretch)
	l.tinted, l.tintedTokens = *base, *aui.TokensFor(base)
	window := root.AnimateColor("tint", l.surface(base), ui.Animation{Duration: 240 * time.Millisecond})
	l.tinted.Surface, l.tintedTokens.BgWindow = window, window
	aui.Register(&l.tinted, &l.tintedTokens)
	root.Background(window).Children(func() {
		c.SetTheme(&l.tinted)
		if l.leftOpen {
			l.sidebar(c)
		}
		c.SetTheme(base)
		l.card(c)
		c.SetTheme(&l.tinted)
		if l.rightOpen {
			l.context(c)
		}
		c.SetTheme(base)
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

// surface is the window's surface: the theme's, mixed toward the active
// tab's project color (RFC 0003 §5), more in a dark theme where a light
// mix reads weaker.
func (l *Layout) surface(t *ui.Theme) ui.Color {
	window := aui.TokensFor(t).BgWindow
	tint := l.slots.Chrome().Tint
	if tint == nil {
		return window
	}
	col := tint()
	if col.A == 0 {
		return window
	}
	amount := float32(0.12)
	if t.Dark {
		amount = 0.18
	}
	return window.Mix(col, amount)
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

// card is the content area, inset from the window's tint: the center
// draws its cards in it (aui.Card). With the sidebar closed, a strip
// above it keeps the window controls and the toggles.
func (l *Layout) card(c *ui.Context) {
	t := c.Theme()
	gap := t.Spacing
	left, right, top := gap, gap, gap
	if l.leftOpen {
		left = gap / 2
	}
	if l.rightOpen {
		right = gap / 2
	}
	ui.Column(c).Grow(1).MinWidth(0).MinHeight(0).Children(func() {
		if !l.leftOpen {
			top = 0
			ui.Row(c).Height(36).Shrink(0).FillWidth().Padding(0, gap, 0, max(l.LeftHeaderSpace(c), gap)).Gap(2).
				AlignItems(ui.Center).DragWindow().Children(func() {
				l.ToggleButton(c, slots.Sidebar)
				if nav := l.slots.Chrome().Nav; nav != nil {
					nav(c)
				}
				ui.Box(c).Grow(1)
				if !l.rightOpen {
					l.ToggleButton(c, slots.Context)
				}
			})
		}
		ui.Column(c).Grow(1).MinWidth(0).MinHeight(0).Margin(top, right, gap, left).Children(func() {
			if view := l.slots.Center(); view != nil {
				view(c)
			}
		})
	})
}

// sidebar is the left column: window controls and its toggle, the shown
// panel, the status line, and the footer that picks the panel. Its edge
// resizes it with no line drawn, which mygo's Split always draws.
func (l *Layout) sidebar(c *ui.Context) {
	t := c.Theme()
	panels := l.slots.Panels(slots.Sidebar)
	shown := shownPanel(panels, l.leftPanel)
	ui.Column(c).Width(l.leftWidth).Shrink(0).FillHeight().Padding(0, t.Spacing/2, t.Spacing, t.Spacing).Children(func() {
		edge := ui.Box(c).Key("sidebar:edge").Absolute().Top(0).Bottom(0).Right(-6).Width(8).Cursor(ui.CursorResizeEW)
		if dx, _, held := edge.Dragged(); held && dx != 0 {
			l.leftWidth = min(max(l.leftWidth+dx, 180), 480)
		}
		head := l.slots.Chrome()
		ui.Row(c).Height(40).Shrink(0).FillWidth().Padding(0, 4, 0, l.LeftHeaderSpace(c)).Gap(2).AlignItems(ui.Center).
			DragWindow().Children(func() {
			if head.Nav != nil {
				head.Nav(c)
			}
			ui.Box(c).Grow(1)
			if !l.rightOpen {
				l.ToggleButton(c, slots.Context)
			}
			l.ToggleButton(c, slots.Sidebar)
		})
		if head.Bar != nil {
			ui.Row(c).Shrink(0).FillWidth().Padding(0, 4, 8, 0).Children(func() { head.Bar(c) })
		}
		if shown == nil {
			ui.Box(c).Grow(1)
		} else {
			l.restore(shown.ID, shown.Restore)
			ui.Column(c).Key("sidebar:" + shown.ID).Grow(1).FillWidth().MinHeight(0).Children(func() {
				shown.View(c, slots.PanelProps{Reveal: l.reveals[shown.ID]})
			})
		}
		ui.Row(c).Height(24).Shrink(0).FillWidth().PaddingX(8).Gap(10).AlignItems(ui.Center).Children(func() {
			if head.Status != nil {
				head.Status(c)
			}
			if l.notice != "" {
				aui.Tooltip(c, ui.Icon(c, icon.Must("triangle-alert")).Size(12, 12).TextColor(t.Warning), l.notice)
			}
		})
		ui.Row(c).Height(36).Shrink(0).FillWidth().Gap(2).AlignItems(ui.Center).Children(func() {
			aui.Tooltip(c, aui.Button(c, aui.ButtonProps{Label: "Settings", Icon: icon.Must("settings"), Variant: aui.ButtonGhost,
				Size: aui.ButtonIconSmall, OnClick: l.openSettings}), "Settings")
			ui.Box(c).Grow(1)
			for i := range panels {
				p := panels[i]
				active := shown != nil && shown.ID == p.ID
				color := t.TextMuted
				if active {
					color = t.Text
				}
				btn := aui.Button(c, aui.ButtonProps{Label: p.Title, Icon: p.Icon, Variant: aui.ButtonGhost,
					Size: aui.ButtonIconSmall, IconColor: color, OnClick: func() { l.RevealPanel(p.ID) }}).
					Checked(active)
				aui.Tooltip(c, btn, p.Title)
				if active {
					btn.Background(aui.TokensOf(c).FillSelected)
				}
			}
		})
	})
}

// context is the right column: every context panel as a section that
// folds, in one card.
func (l *Layout) context(c *ui.Context) {
	t := c.Theme()
	panels := l.slots.Panels(slots.Context)
	ui.Column(c).Width(l.rightWidth).Shrink(0).FillHeight().Padding(0, t.Spacing, t.Spacing, t.Spacing/2).Children(func() {
		ui.Row(c).Height(40).Shrink(0).FillWidth().Padding(0, c.TitleBar().Right, 0, 0).AlignItems(ui.Center).
			DragWindow().Children(func() {
			ui.Box(c).Grow(1)
			l.ToggleButton(c, slots.Context)
		})
		aui.Card(c, ui.Column(c).Grow(1).FillWidth().MinHeight(0).Dividers(1, aui.TokensOf(c).BorderSubtle)).Children(func() {
			for i := range panels {
				l.section(c, panels[i])
			}
		})
	})
}

func (l *Layout) section(c *ui.Context, p slots.Panel) {
	open := !l.collapsed[p.ID]
	col := ui.Column(c).Key("context:" + p.ID).FillWidth().MinHeight(0)
	if open {
		col.Grow(1)
	}
	col.Children(func() {
		ui.Row(c).Height(32).Shrink(0).FillWidth().Padding(0, 6, 0, 10).AlignItems(ui.Center).Children(func() {
			head := ui.Row(c).Grow(1).MinWidth(0).FillHeight().Gap(6).AlignItems(ui.Center).
				Cursor(ui.CursorPointer).Role(ui.RoleButton).Label(p.Title).Checked(open)
			head.Children(func() {
				aui.Disclosure(c, open, 12)
				if p.Heading != nil {
					p.Heading(c)
				} else {
					aui.SectionLabel(c, p.Title)
				}
			})
			if head.Clicked() {
				l.collapsed[p.ID] = open
				l.changed()
			}
			if open && p.Actions != nil {
				ui.Row(c).Shrink(0).Gap(2).AlignItems(ui.Center).Children(func() { p.Actions(c) })
			}
		})
		if !open {
			return
		}
		l.restore(p.ID, p.Restore)
		ui.Column(c).Grow(1).FillWidth().MinHeight(0).Children(func() {
			p.View(c, slots.PanelProps{Reveal: l.reveals[p.ID]})
		})
	})
}

func (l *Layout) openSettings() {
	if l.act == nil {
		return
	}
	if cmd := l.act.Lookup("app:open-settings"); cmd != nil && cmd.Main != nil {
		cmd.Main()
	}
}

func (l *Layout) commands(sh *shell.Shell) []actions.Command {
	cmd := func(id, title, keys string, fn func()) actions.Command {
		return actions.Command{ID: id, Title: title, Keys: keys, Main: fn, Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, sh, func() (string, error) { fn(); return "", nil })
		}}
	}
	return []actions.Command{
		cmd("app:toggle-left-sidebar", "Toggle left sidebar", "Ctrl B", func() { l.Toggle(slots.Sidebar) }),
		cmd("app:toggle-right-sidebar", "Toggle right sidebar", "Ctrl Alt B", func() { l.Toggle(slots.Context) }),
	}
}

// Register makes l the window's root and registers its commands until off is called.
func Register(l *Layout, sh *shell.Shell, _ *slots.Registry, act *actions.Service) (off func()) {
	l.act = act
	offs := []func(){
		sh.SetRoot(l.View),
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
