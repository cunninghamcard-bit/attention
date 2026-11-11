// Package layout is the layout UI plugin (dsh's ui-layout).
package layout

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"

	"github.com/arcships/rutis/go/rutis"
	"github.com/cunninghamcard-bit/acard-ui/components/button"
	"github.com/cunninghamcard-bit/acard-ui/components/tooltip"
	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/appearance"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
	auiicon "github.com/cunninghamcard-bit/attention/native/ui/icon"
)

const (
	// ID is the plugin's name.
	ID = "layout"
	// headerHeight is the band above the cards: window controls, the
	// toggles and the nav buttons.
	headerHeight = 30
	toggleSize   = 24
)

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
func (l *Layout) ToggleButton(c *ui.Context, d slots.Dock) ui.Element {
	glyph := auiicon.Must("panel-left")
	if d == slots.Context {
		glyph = auiicon.Must("panel-right")
	}
	tip := "Expand"
	if l.Open(d) {
		tip = "Collapse"
	}
	b := button.Button(c, button.ButtonProps{Label: tip, Variant: button.ButtonGhost, Size: button.ButtonSm,
		Children: func() { ui.Icon(c, glyph).Size(14, 14) }}).Size(24, 24).MinHeight(24).PaddingX(0)
	if b.Clicked() {
		l.Toggle(d)
	}
	tooltip.Tooltip(c, b, tooltip.TooltipProps{Text: tip})
	return b
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
	ui.Row(c).Fill().AlignItems(ui.Stretch).Background(aui.TokensFor(base).BgWindow).Children(func() {
		if l.leftOpen {
			l.sidebar(c)
		}
		l.card(c)
		if l.rightOpen {
			l.context(c)
		}
		l.toggles(c)
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

// toggles are the two toggles at the window's top corners, where they
// stay whether their column is open or not, so a click never moves them.
func (l *Layout) toggles(c *ui.Context) {
	top := float32(headerHeight-toggleSize) / 2
	l.ToggleButton(c, slots.Sidebar).Absolute().Top(top).Left(l.toggleLeft(c))
	l.ToggleButton(c, slots.Context).Absolute().Top(top).Right(l.toggleRight(c))
}

// toggleLeft is the sidebar toggle's left edge: past the window controls.
func (l *Layout) toggleLeft(c *ui.Context) float32 {
	return max(l.LeftHeaderSpace(c), c.Theme().Spacing)
}

// toggleRight is the context toggle's right edge: inside the window
// controls on the right, where a system has them.
func (l *Layout) toggleRight(c *ui.Context) float32 {
	return c.Theme().Spacing + c.TitleBar().Right
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
// draws its cards in it (aui.Card), below a band level with the columns'
// headers that holds the nav buttons while the sidebar is closed.
func (l *Layout) card(c *ui.Context) {
	t := c.Theme()
	gap := t.Spacing
	left, right := gap, gap
	if l.leftOpen {
		left = gap / 2
	}
	if l.rightOpen {
		right = gap / 2
	}
	ui.Column(c).Grow(1).MinWidth(0).MinHeight(0).Children(func() {
		band := ui.Row(c).Height(headerHeight).Shrink(0).FillWidth().Gap(2).AlignItems(ui.Center).DragWindow()
		if !l.leftOpen {
			band.Padding(0, 0, 0, l.toggleLeft(c)+toggleSize+2)
		}
		band.Children(func() {
			if nav := l.slots.Chrome().Nav; nav != nil && !l.leftOpen {
				nav(c)
			}
		})
		ui.Column(c).Grow(1).MinWidth(0).MinHeight(0).Margin(0, right, gap, left).Children(func() {
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
		ui.Row(c).Height(headerHeight).Shrink(0).FillWidth().Padding(0, 4, 0, l.toggleLeft(c)+toggleSize+2-t.Spacing).Gap(2).
			AlignItems(ui.Center).DragWindow().Children(func() {
			if head.Nav != nil {
				head.Nav(c)
			}
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
				tooltip.Tooltip(c, ui.Icon(c, icon.TriangleAlert.SVG()).Size(12, 12).TextColor(t.Warning), tooltip.TooltipProps{Text: l.notice})
			}
		})
		ui.Row(c).Height(36).Shrink(0).FillWidth().Gap(2).AlignItems(ui.Center).Children(func() {
			settings := button.Button(c, button.ButtonProps{Label: "Settings", Variant: button.ButtonGhost, Size: button.ButtonSm,
				Children: func() { ui.Icon(c, icon.Settings.SVG()).Size(14, 14) }}).Width(28).PaddingX(0)
			if settings.Clicked() {
				l.openSettings()
			}
			tooltip.Tooltip(c, settings, tooltip.TooltipProps{Text: "Settings"})
			ui.Box(c).Grow(1)
			for i := range panels {
				p := panels[i]
				active := shown != nil && shown.ID == p.ID
				color := t.TextMuted
				if active {
					color = t.Text
				}
				btn := button.Button(c, button.ButtonProps{Label: p.Title, Variant: button.ButtonGhost, Size: button.ButtonSm,
					Children: func() { ui.Icon(c, p.Icon).Size(14, 14).TextColor(color) }}).Width(28).PaddingX(0).
					Checked(active)
				if btn.Clicked() {
					l.RevealPanel(p.ID)
				}
				tooltip.Tooltip(c, btn, tooltip.TooltipProps{Text: p.Title})
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
		ui.Row(c).Height(headerHeight).Shrink(0).FillWidth().DragWindow()
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
		{ID: "screenshot", CLI: true, Run: func(_ context.Context, a actions.Args) (string, error) { return screenshot(sh, a.Params["path"]) }},
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

// screenshot writes the window's content as a PNG to path (`screenshot
// path=…`), which needs no screen recording permission. CapturePage hops
// to the main thread itself, so it runs here, off it.
func screenshot(sh *shell.Shell, path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("Missing required parameter: path=<absolute .png path>")
	}
	w := sh.Window()
	if w == nil {
		return "", fmt.Errorf("No window is open.")
	}
	data, err := w.CapturePage()
	if err != nil {
		return "", fmt.Errorf("capture the window: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("write screenshot: %w", err)
	}
	return "Saved: " + path, nil
}
