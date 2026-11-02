// Package appearance is the standalone appearance and theme plugin
// (apps/web/core/AppearanceManager.ts, apps/web/builtin/AppearanceSettingTab.ts,
// docs/appearance.md).
package appearance

import (
	"context"
	"os"
	"slices"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
)

// ID is the plugin's name.
const ID = "appearance"

// Plugin manages themes, fonts, icons and appearance settings while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "slots", "settings", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var sh *shell.Shell
		var sl *slots.Registry
		var set *settings.Settings
		var act *actions.Service
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		if err := rctx.Use("slots", &sl); err != nil {
			return err
		}
		if err := rctx.Use("settings", &set); err != nil {
			return err
		}
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		m, off := Register(sh, sl, set, act)
		rctx.Provide("appearance", m)
		rctx.Effect(func(_ context.Context) error {
			off()
			return nil
		})
		return nil
	},
})

type rowSpec struct {
	label, desc string
	control     func(c *ui.Context)
}

type sectionSpec struct {
	title string
	rows  []rowSpec
}

// Manager synchronizes appearance.json with the UI, editor, markdown and icon themes.
type Manager struct {
	sh          *shell.Shell
	settings    *settings.Settings
	seenGen     int
	accentDraft string
	ifaceDraft  string
	textDraft   string
	monoDraft   string
	draftsInit  bool

	IsDark func() bool
}

// New creates an Appearance Manager backed by set.
func New(sh *shell.Shell, set *settings.Settings) *Manager {
	m := &Manager{
		sh:       sh,
		settings: set,
		seenGen:  -1,
		IsDark:   mygo.Theme.IsDark,
	}
	m.Sync()
	return m
}

// Register installs the Appearance settings tab and theme commands.
func Register(sh *shell.Shell, sl *slots.Registry, set *settings.Settings, act *actions.Service) (*Manager, func()) {
	m := New(sh, set)
	offs := []func(){
		sl.RegisterSettingsSection(slots.SettingsSection{
			ID:       ID,
			Title:    "Appearance",
			Icon:     lucide.Palette(),
			Order:    20,
			Keywords: m.keywords(),
			View:     m.View,
		}),
	}
	for _, cmd := range m.commands() {
		offs = append(offs, act.Add(cmd))
	}
	return m, func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

// Sync refreshes the active appearance configuration from settings when changed.
func (m *Manager) Sync() textdoc.Appearance {
	if m == nil || m.settings == nil {
		return textdoc.CurrentAppearance()
	}
	gen := m.settings.Generation()
	if gen == m.seenGen {
		return textdoc.CurrentAppearance()
	}
	m.seenGen = gen
	a := LoadFrom(m.settings)
	textdoc.SetAppearance(a)
	if !m.draftsInit {
		m.draftsInit = true
		m.accentDraft = a.AccentColor
		m.ifaceDraft = a.InterfaceFont
		m.textDraft = a.TextFont
		m.monoDraft = a.MonospaceFont
	}
	return a
}

// Dark reports whether dark mode is active.
func (m *Manager) Dark() bool {
	a := m.Sync()
	switch a.Theme {
	case "moonstone":
		return false
	case "obsidian":
		return true
	}
	if m != nil && m.IsDark != nil {
		return m.IsDark()
	}
	return false
}

// Theme returns the active window *ui.Theme.
func (m *Manager) Theme() *ui.Theme {
	return textdoc.UITheme(m.Dark())
}

// ToggleTheme switches between light ("moonstone") and dark ("obsidian").
func (m *Manager) ToggleTheme() {
	if m == nil || m.settings == nil {
		return
	}
	if m.Dark() {
		m.settings.Set(settings.Appearance, "theme", "moonstone")
	} else {
		m.settings.Set(settings.Appearance, "theme", "obsidian")
	}
	m.Sync()
}

// CycleColorTheme cycles the active light or dark theme across loaded theme files.
func (m *Manager) CycleColorTheme() {
	if m == nil || m.settings == nil {
		return
	}
	a := m.Sync()
	dark := m.Dark()
	list := textdoc.AvailableThemes(dark)
	if len(list) == 0 {
		return
	}
	key, cur := "lightTheme", a.LightTheme
	if dark {
		key, cur = "darkTheme", a.DarkTheme
	}
	idx := slices.Index(list, cur)
	next := list[(idx+1)%len(list)]
	m.settings.Set(settings.Appearance, key, next)
	m.Sync()
}

// View renders the Appearance settings tab.
func (m *Manager) View(c *ui.Context) {
	a := m.Sync()
	for _, sec := range m.sections(a) {
		rows := sec.rows
		omgui.SettingsSection(c, sec.title, func() {
			for _, r := range rows {
				omgui.PreferenceRow(c, r.label, r.desc, func() { r.control(c) })
			}
		})
	}
}

func (m *Manager) keywords() []string {
	var out []string
	for _, sec := range m.sections(textdoc.DefaultAppearance()) {
		out = append(out, sec.title)
		for _, r := range sec.rows {
			out = append(out, r.label)
		}
	}
	return out
}

func (m *Manager) sections(a textdoc.Appearance) []sectionSpec {
	return []sectionSpec{
		{
			title: "Theme",
			rows: []rowSpec{
				m.selectSpec("Base color scheme", "Choose the color scheme used by the app.", "theme", a.Theme, []omgui.SelectOption{
					{Value: "system", Label: "Adapt to system"},
					{Value: "moonstone", Label: "Light"},
					{Value: "obsidian", Label: "Dark"},
				}),
				m.selectSpec("Light theme", "Theme loaded from JSON files for light mode.", "lightTheme", a.LightTheme, themeOptions(false)),
				m.selectSpec("Dark theme", "Theme loaded from JSON files for dark mode.", "darkTheme", a.DarkTheme, themeOptions(true)),
				{
					label: "Themes folder",
					desc:  textdoc.ThemesDir(),
					control: func(c *ui.Context) {
						ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
							omgui.Button(c, omgui.ButtonProps{Label: "Reload", Variant: omgui.ButtonGhost, Size: omgui.ButtonSM, OnClick: func() {
								textdoc.ReloadThemes()
							}})
							omgui.Button(c, omgui.ButtonProps{Label: "Open", Variant: omgui.ButtonSecondary, Size: omgui.ButtonSM, OnClick: func() {
								dir := textdoc.ThemesDir()
								_ = os.MkdirAll(dir, 0o755)
								go func() { _ = mygo.Shell.OpenPath(dir) }()
							}})
						})
					},
				},
				m.selectSpec("Accent scheme", "Preset accent palette for controls and focus rings.", "accent", a.Accent, []omgui.SelectOption{
					{Value: "default", Label: "Default"},
					{Value: "ocean", Label: "Ocean"},
					{Value: "forest", Label: "Forest"},
					{Value: "rose", Label: "Rose"},
					{Value: "amber", Label: "Amber"},
				}),
				{
					label: "Custom accent color",
					desc:  "Hex override (#RRGGBB) used for primary controls and highlights.",
					control: func(c *ui.Context) {
						t := c.Theme()
						ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
							swatch := t.Accent
							if norm := textdoc.NormalizeHexColor(m.accentDraft); norm != "" {
								swatch = ui.Hex(norm)
							}
							ui.Box(c).Size(20, 20).Radius(6).Background(swatch).Border(1, t.Border)
							prev := m.accentDraft
							omgui.Field(c, &m.accentDraft, "#526fff", false).Width(110)
							if m.accentDraft != prev {
								if norm := textdoc.NormalizeHexColor(m.accentDraft); norm != "" {
									m.set("accentColor", norm)
								} else if m.accentDraft == "" {
									m.unset("accentColor")
								}
							}
							if a.AccentColor != "" {
								omgui.Button(c, omgui.ButtonProps{Label: "Reset", Variant: omgui.ButtonGhost, Size: omgui.ButtonSM, OnClick: func() {
									m.accentDraft = ""
									m.unset("accentColor")
								}})
							}
						})
					},
				},
				m.selectSpec("File icon theme", "Icon style for the file explorer, tabs, and search results.", "iconTheme", a.IconTheme, []omgui.SelectOption{
					{Value: "pierre", Label: "Pierre (Colored)"},
					{Value: "zed", Label: "Zed (Minimal)"},
				}),
			},
		},
		{
			title: "Font",
			rows: []rowSpec{
				m.fontSpec("Interface font", "Set the base font for the application interface.", "interfaceFontFamily", &m.ifaceDraft, a.InterfaceFont, "System default"),
				m.fontSpec("Text font", "Set the font used in Markdown reading views.", "textFontFamily", &m.textDraft, a.TextFont, "System default"),
				m.fontSpec("Monospace font", "Set the font for code buffers and code blocks.", "monospaceFontFamily", &m.monoDraft, a.MonospaceFont, "Zed Mono, JetBrains Mono, SF Mono"),
				m.numberSpec("Font size", "Base interface and reading font size in pixels (10–30).", "baseFontSize", float64(a.BaseFontSize), 14, 10, 30),
				m.numberSpec("Editor font size", "Code buffer font size in pixels (10–30).", "editorFontSize", float64(a.EditorFontSize), float64(textdoc.CodeFontSize), 10, 30),
			},
		},
		{
			title: "Editor",
			rows: []rowSpec{
				m.selectSpec("Line height", "Vertical rhythm for code buffers (Zed comfortable = 1.618).", "lineHeight", a.LineHeightMode, []omgui.SelectOption{
					{Value: "comfortable", Label: "Comfortable (1.618)"},
					{Value: "standard", Label: "Standard (1.3)"},
				}),
				m.numberSpec("Tab size", "Number of spaces per tab stop (1–8).", "tabSize", float64(a.EffectiveTabSize()), 4, 1, 8),
				m.switchSpec("Italic comments", "Render source code comments in italics.", "italicComments", a.ItalicComments),
				m.switchSpec("Show line numbers", "Display line numbers in the code editor gutter.", "showLineNumbers", a.ShowLineNums),
				m.switchSpec("Show indent guides", "Draw vertical indentation guide lines in code buffers.", "showIndentGuides", a.ShowGuides),
			},
		},
		{
			title: "Interface",
			rows: []rowSpec{
				m.switchSpec("Show ribbon", "Display the vertical action ribbon on the left edge.", "showRibbon", a.ShowRibbon),
				m.switchSpec("Show view header", "Display the breadcrumb header bar above the active pane.", "showViewHeader", a.ShowViewHeader),
				m.switchSpec("Show inline title", "Display the filename as an editable title inside the document.", "showInlineTitle", a.ShowInline),
				m.switchSpec("Show tab bar", "Display the tab strip at the top of each pane.", "showTabBar", a.ShowTabBar),
				m.switchSpec("Show file icons", "Display file and folder icons in the file tree and tabs.", "showFileIcons", a.ShowFileIcons),
				m.selectSpec("File tree density", "Row height in the Files sidebar panel.", "treeDensity", a.TreeDensity, []omgui.SelectOption{
					{Value: "standard", Label: "Standard (26px)"},
					{Value: "comfortable", Label: "Comfortable (30px)"},
				}),
				m.numberSpec("Spacing", "Base layout spacing unit in DIPs (4–16).", "spacing", float64(a.Spacing), 8, 4, 16),
				m.numberSpec("Corner radius", "Control and card corner radius in DIPs (0–16).", "radius", float64(a.Radius), 8, 0, 16),
				m.numberSpec("Scrollbar width", "Scrollbar thumb thickness in DIPs (2–12).", "scrollbarWidth", float64(a.ScrollbarWidth), 4, 2, 12),
			},
		},
	}
}

func (m *Manager) selectSpec(label, desc, key, cur string, opts []omgui.SelectOption) rowSpec {
	return rowSpec{label: label, desc: desc, control: func(c *ui.Context) {
		v := cur
		omgui.Select(c, omgui.SelectProps{Key: "appearance:" + key, Value: &v, Width: 176, Options: opts})
		if v != cur {
			m.set(key, v)
		}
	}}
}

func (m *Manager) switchSpec(label, desc, key string, cur bool) rowSpec {
	return rowSpec{label: label, desc: desc, control: func(c *ui.Context) {
		on := cur
		ui.Switch(c, &on)
		if on != cur {
			m.set(key, on)
		}
	}}
}

func (m *Manager) fontSpec(label, desc, key string, draft *string, cur, placeholder string) rowSpec {
	return rowSpec{label: label, desc: desc, control: func(c *ui.Context) {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			prev := *draft
			omgui.Field(c, draft, placeholder, false).Width(220)
			if *draft != prev {
				if *draft == "" {
					m.unset(key)
				} else {
					m.set(key, *draft)
				}
			}
			if cur != "" {
				omgui.Button(c, omgui.ButtonProps{Label: "Reset", Variant: omgui.ButtonGhost, Size: omgui.ButtonSM, OnClick: func() {
					*draft = ""
					m.unset(key)
				}})
			}
		})
	}}
}

func (m *Manager) numberSpec(label, desc, key string, cur, def, low, high float64) rowSpec {
	return rowSpec{label: label, desc: desc, control: func(c *ui.Context) {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			v := cur
			omgui.NumberField(c, &v, low, high, label, func(next float64) {
				if key == "tabSize" {
					m.set(key, int(next))
				} else {
					m.set(key, next)
				}
			})
			if cur != def {
				omgui.Button(c, omgui.ButtonProps{Label: "Reset", Variant: omgui.ButtonGhost, Size: omgui.ButtonSM, OnClick: func() {
					m.unset(key)
				}})
			}
		})
	}}
}

func (m *Manager) set(key string, v any) {
	if m.settings != nil {
		m.settings.Set(settings.Appearance, key, v)
		m.Sync()
	}
}

func (m *Manager) unset(key string) {
	if m.settings != nil {
		m.settings.Unset(settings.Appearance, key)
		m.Sync()
	}
}

func (m *Manager) commands() []actions.Command {
	cmd := func(id, title string, fn func()) actions.Command {
		return actions.Command{ID: id, Title: title, Main: fn, Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, m.sh, func() (string, error) { fn(); return "", nil })
		}}
	}
	return []actions.Command{
		cmd("appearance:toggle-theme", "Toggle light/dark theme", m.ToggleTheme),
		cmd("theme:selector", "Switch color theme", m.CycleColorTheme),
	}
}

// LoadFrom reads a textdoc.Appearance from s with v1 defaults.
func LoadFrom(s *settings.Settings) textdoc.Appearance {
	a := textdoc.DefaultAppearance()
	if s == nil {
		return a
	}
	s.Get(settings.Appearance, "theme", &a.Theme)
	s.Get(settings.Appearance, "lightTheme", &a.LightTheme)
	s.Get(settings.Appearance, "darkTheme", &a.DarkTheme)
	s.Get(settings.Appearance, "accent", &a.Accent)
	s.Get(settings.Appearance, "accentColor", &a.AccentColor)
	s.Get(settings.Appearance, "iconTheme", &a.IconTheme)
	s.Get(settings.Appearance, "interfaceFontFamily", &a.InterfaceFont)
	s.Get(settings.Appearance, "textFontFamily", &a.TextFont)
	s.Get(settings.Appearance, "monospaceFontFamily", &a.MonospaceFont)
	s.Get(settings.Appearance, "baseFontSize", &a.BaseFontSize)
	s.Get(settings.Appearance, "editorFontSize", &a.EditorFontSize)
	s.Get(settings.Appearance, "tabSize", &a.TabSize)
	s.Get(settings.Appearance, "lineHeight", &a.LineHeightMode)
	s.Get(settings.Appearance, "customLineHeight", &a.CustomLineH)
	s.Get(settings.Appearance, "italicComments", &a.ItalicComments)
	s.Get(settings.Appearance, "showLineNumbers", &a.ShowLineNums)
	s.Get(settings.Appearance, "showIndentGuides", &a.ShowGuides)
	s.Get(settings.Appearance, "showRibbon", &a.ShowRibbon)
	s.Get(settings.Appearance, "showViewHeader", &a.ShowViewHeader)
	s.Get(settings.Appearance, "showInlineTitle", &a.ShowInline)
	s.Get(settings.Appearance, "showTabBar", &a.ShowTabBar)
	s.Get(settings.Appearance, "showFileIcons", &a.ShowFileIcons)
	s.Get(settings.Appearance, "treeDensity", &a.TreeDensity)
	s.Get(settings.Appearance, "spacing", &a.Spacing)
	s.Get(settings.Appearance, "radius", &a.Radius)
	s.Get(settings.Appearance, "scrollbarWidth", &a.ScrollbarWidth)
	return a
}

func themeOptions(dark bool) []omgui.SelectOption {
	names := textdoc.AvailableThemes(dark)
	opts := make([]omgui.SelectOption, 0, len(names))
	for _, n := range names {
		opts = append(opts, omgui.SelectOption{Value: n, Label: n})
	}
	return opts
}
