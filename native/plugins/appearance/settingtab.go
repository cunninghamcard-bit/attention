package appearance

import (
	"os"
	"slices"
	"strings"

	"github.com/cunninghamcard-bit/acard-ui/components/button"
	"github.com/cunninghamcard-bit/acard-ui/components/input"
	"github.com/cunninghamcard-bit/acard-ui/components/selectmenu"
	"github.com/cunninghamcard-bit/acard-ui/components/toggleswitch"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

type tab struct {
	iface, text, mono string
	init              bool
}

type rowSpec struct {
	label, desc string
	control     func(c *ui.Context)
}

type sectionSpec struct {
	title string
	rows  []rowSpec
}

// View draws the Appearance settings tab.
func (a *Appearance) View(c *ui.Context) {
	s := a.Settings()
	if !a.tab.init {
		a.tab = tab{iface: s.InterfaceFont, text: s.TextFont, mono: s.MonospaceFont, init: true}
	}
	for _, sec := range a.sections(s) {
		aui.SettingsSection(c, sec.title, func() {
			for _, r := range sec.rows {
				aui.PreferenceRow(c, r.label, r.desc, func() { r.control(c) })
			}
		})
	}
}

func (a *Appearance) keywords() []string {
	var out []string
	for _, sec := range a.sections(DefaultSettings()) {
		out = append(out, sec.title)
		for _, r := range sec.rows {
			out = append(out, r.label)
		}
	}
	return out
}

func (a *Appearance) sections(s Settings) []sectionSpec {
	return []sectionSpec{
		{
			title: "Theme",
			rows: []rowSpec{
				a.selectSpec("Base color scheme", "Choose the color scheme used by the app.", "theme", s.Theme, []selectmenu.SelectOption{
					{Value: "system", Label: "Adapt to system"},
					{Value: "light", Label: "Light"},
					{Value: "dark", Label: "Dark"},
				}),
				a.selectSpec("Light theme", "Color theme in light mode.", "lightTheme", s.LightTheme, a.themeOptions(false)),
				a.selectSpec("Dark theme", "Color theme in dark mode.", "darkTheme", s.DarkTheme, a.themeOptions(true)),
				{
					label:   "Themes folder",
					desc:    strings.Join(slices.Concat([]string{a.dir}, a.cat.errs), "\n"),
					control: a.themesFolder,
				},
				a.selectSpec("File icon theme", "Icon style for the file explorer, tabs, and search results.", "iconTheme", s.IconTheme, []selectmenu.SelectOption{
					{Value: "pierre", Label: "Pierre (Colored)"},
					{Value: "zed", Label: "Zed (Minimal)"},
				}),
			},
		},
		{
			title: "Font",
			rows: []rowSpec{
				a.fontSpec("Interface font", "Set the base font for the application interface.", "interfaceFontFamily", &a.tab.iface, s.InterfaceFont, "System default"),
				a.fontSpec("Text font", "Set the font used in Markdown reading views.", "textFontFamily", &a.tab.text, s.TextFont, "System default"),
				a.fontSpec("Monospace font", "Set the font for code buffers and code blocks.", "monospaceFontFamily", &a.tab.mono, s.MonospaceFont, "Zed Mono, JetBrains Mono, SF Mono"),
				a.numberSpec("Font size", "Base interface and reading font size in pixels (10–30).", "baseFontSize", float64(s.BaseFontSize), 14, 10, 30),
				a.numberSpec("Editor font size", "Code buffer font size in pixels (10–30).", "editorFontSize", float64(s.EditorFontSize), float64(CodeFontSize), 10, 30),
			},
		},
		{
			title: "Editor",
			rows: []rowSpec{
				a.selectSpec("Line height", "Vertical rhythm for code buffers (Zed comfortable = 1.618).", "lineHeight", s.LineHeightMode, []selectmenu.SelectOption{
					{Value: "comfortable", Label: "Comfortable (1.618)"},
					{Value: "standard", Label: "Standard (1.3)"},
				}),
				a.numberSpec("Tab size", "Number of spaces per tab stop (1–8).", "tabSize", float64(s.EffectiveTabSize()), 4, 1, 8),
				a.switchSpec("Italic comments", "Render source code comments in italics.", "italicComments", s.ItalicComments),
				a.switchSpec("Show line numbers", "Display line numbers in the code editor gutter.", "showLineNumbers", s.ShowLineNums),
				a.switchSpec("Show indent guides", "Draw vertical indentation guide lines in code buffers.", "showIndentGuides", s.ShowGuides),
			},
		},
		{
			title: "Interface",
			rows: []rowSpec{
				a.switchSpec("Show inline title", "Display the filename as an editable title inside the document.", "showInlineTitle", s.ShowInline),
				a.switchSpec("Show file icons", "Display file and folder icons in the file tree and tabs.", "showFileIcons", s.ShowFileIcons),
				a.selectSpec("Density", "Height of controls and rows, room around content, and line height in reading views.", "density", s.Density, []selectmenu.SelectOption{
					{Value: "compact", Label: "Compact"},
					{Value: "comfortable", Label: "Comfortable"},
					{Value: "spacious", Label: "Spacious"},
				}),
				a.numberSpec("Corner radius", "Control and card corner radius in DIPs (0–16).", "radius", float64(s.Radius), 10, 0, 16),
				a.numberSpec("Scrollbar width", "Scrollbar thumb thickness in DIPs (2–12).", "scrollbarWidth", float64(s.ScrollbarWidth), 4, 2, 12),
			},
		},
	}
}

func (a *Appearance) themesFolder(c *ui.Context) {
	ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
		if button.Button(c, button.ButtonProps{Variant: button.ButtonGhost, LabelKey: "Reload",
			Children: func() { ui.Text(c, "Reload") }}).Clicked() {
			a.Reload()
		}
		if button.Button(c, button.ButtonProps{Variant: button.ButtonSecondary, LabelKey: "Open",
			Children: func() { ui.Text(c, "Open") }}).Clicked() {
			dir := a.dir
			go func() {
				_ = os.MkdirAll(dir, 0o755)
				_ = mygo.Shell.OpenPath(dir)
			}()
		}
	})
}

func (a *Appearance) selectSpec(label, desc, key, cur string, opts []selectmenu.SelectOption) rowSpec {
	return rowSpec{label: label, desc: desc, control: func(c *ui.Context) {
		v := cur
		selectmenu.Select(c.Key("appearance:"+key), &v, selectmenu.SelectProps{Options: opts}).Label(label).Width(176)
		if v != cur {
			a.set.Set(settings.Appearance, key, v)
		}
	}}
}

func (a *Appearance) switchSpec(label, desc, key string, cur bool) rowSpec {
	return rowSpec{label: label, desc: desc, control: func(c *ui.Context) {
		on := cur
		if toggleswitch.Switch(c, &on, toggleswitch.SwitchProps{}).Label(label).Changed() {
			a.set.Set(settings.Appearance, key, on)
		}
	}}
}

func (a *Appearance) fontSpec(label, desc, key string, draft *string, cur, placeholder string) rowSpec {
	return rowSpec{label: label, desc: desc, control: func(c *ui.Context) {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			prev := *draft
			ui.Column(c).Width(220).Children(func() {
				input.Input(c, draft, input.InputProps{Placeholder: placeholder}).Label(label)
			})
			if *draft != prev {
				if *draft == "" {
					a.set.Unset(settings.Appearance, key)
				} else {
					a.set.Set(settings.Appearance, key, *draft)
				}
			}
			if cur != "" {
				if resetButton(c).Clicked() {
					*draft = ""
					a.set.Unset(settings.Appearance, key)
				}
			}
		})
	}}
}

func (a *Appearance) numberSpec(label, desc, key string, cur, def, low, high float64) rowSpec {
	return rowSpec{label: label, desc: desc, control: func(c *ui.Context) {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			v := cur
			aui.NumberField(c, &v, low, high, label, func(next float64) {
				if key == "tabSize" {
					a.set.Set(settings.Appearance, key, int(next))
				} else {
					a.set.Set(settings.Appearance, key, next)
				}
			})
			if cur != def {
				if resetButton(c).Clicked() {
					a.set.Unset(settings.Appearance, key)
				}
			}
		})
	}}
}

func (a *Appearance) themeOptions(dark bool) []selectmenu.SelectOption {
	names := a.cat.names(dark)
	opts := make([]selectmenu.SelectOption, 0, len(names))
	for _, n := range names {
		opts = append(opts, selectmenu.SelectOption{Value: n, Label: n})
	}
	return opts
}

func resetButton(c *ui.Context) ui.Element {
	return button.Button(c, button.ButtonProps{Variant: button.ButtonGhost, LabelKey: "Reset",
		Children: func() { ui.Text(c, "Reset") }})
}
