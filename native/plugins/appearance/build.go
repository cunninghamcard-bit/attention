package appearance

import (
	"github.com/egoist/mygo/plugins/terminal"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"

	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

// accentSchemes are the preset accents of the "accent" setting.
var accentSchemes = map[string]ui.Color{
	"ocean":  ui.Hex("#1f3a7a"),
	"forest": ui.Hex("#1f5a3a"),
	"rose":   ui.Hex("#8a2e4a"),
	"amber":  ui.Hex("#7a5a1f"),
}

// built are the widget themes one Theme and the settings make.
type built struct {
	ui       *ui.Theme
	editor   *editor.Theme
	markdown *markdown.Theme
	terminal *terminal.Theme
}

func build(t Theme, s Settings) built {
	u := buildUI(t, s)
	ed := buildEditor(t, u, s)
	return built{ui: u, editor: ed, markdown: buildMarkdown(u, ed, s), terminal: buildTerminal(t, u)}
}

func buildUI(t Theme, s Settings) *ui.Theme {
	u := ui.LightTheme()
	if t.Dark {
		u = ui.DarkTheme()
	}
	c := t.Colors
	u.Background, u.Surface, u.Border = c.Background, c.Surface, c.Border
	u.Text, u.TextMuted = c.Text, c.TextMuted
	u.SurfaceHover = c.Text.Alpha(0.06)
	u.SurfacePressed = c.Text.Alpha(0.1)
	u.Danger, u.Warning, u.Success = c.Danger, c.Warning, c.Success
	u.Scrollbar = c.Border
	u.Inverse, u.InverseText = c.Text, c.Background
	u.Radius, u.Spacing, u.FontSize, u.ScrollbarWidth = 10, 8, 14, 4
	accent := c.Accent
	if a, ok := accentSchemes[s.Accent]; ok {
		accent = a
	}
	applyAccent(u, accent)
	u.Selection = u.Accent.Alpha(0.25)
	if c, ok := aui.ParseColor(s.AccentColor); ok {
		applyAccent(u, c)
	}
	if s.InterfaceFont != "" {
		u.Font = s.InterfaceFont
	}
	if s.BaseFontSize >= 10 && s.BaseFontSize <= 30 {
		u.FontSize = s.BaseFontSize
	}
	if s.Spacing >= 2 && s.Spacing <= 16 {
		u.Spacing = s.Spacing
	}
	if s.Radius >= 0 && s.Radius <= 20 {
		u.Radius = s.Radius
	}
	if s.ScrollbarWidth >= 2 && s.ScrollbarWidth <= 14 {
		u.ScrollbarWidth = s.ScrollbarWidth
	}
	return u
}

func buildEditor(t Theme, u *ui.Theme, s Settings) *editor.Theme {
	ed := editor.DefaultTheme(u)
	ed.Error, ed.Warning, ed.Info, ed.Hint = u.Danger, u.Warning, u.Accent, u.TextMuted
	ed.Added, ed.Deleted, ed.Modified = u.Success, u.Danger, u.Warning
	ed.Tokens[editor.TokenHeading].Color = u.Text
	ed.Tokens[editor.TokenLink].Color = u.Accent
	ed.Tokens[editor.TokenInserted].Color = u.Success
	ed.Tokens[editor.TokenDeleted].Color = u.Danger
	ed.Tokens[editor.TokenInvalid].Color = u.Danger
	set := func(c ui.Color, kinds ...editor.TokenKind) {
		if c == (ui.Color{}) {
			return
		}
		for _, k := range kinds {
			ed.Tokens[k].Color = c
		}
	}
	sy := t.Syntax
	set(sy.Comment, editor.TokenComment)
	set(sy.Keyword, editor.TokenKeyword, editor.TokenMeta)
	set(sy.String, editor.TokenString, editor.TokenEscape, editor.TokenRegexp, editor.TokenCode)
	set(sy.Number, editor.TokenNumber, editor.TokenConstant)
	set(sy.Function, editor.TokenFunction)
	set(sy.Type, editor.TokenType)
	set(sy.Variable, editor.TokenVariable, editor.TokenProperty, editor.TokenAttribute)
	set(sy.Punctuation, editor.TokenPunctuation, editor.TokenOperator)
	set(sy.Tag, editor.TokenTag)
	ed.Tokens[editor.TokenComment].Italic = s.ItalicComments
	ed.Tokens[editor.TokenHeading].Bold = true
	ed.Tokens[editor.TokenStrong].Bold = true
	ed.Tokens[editor.TokenEmphasis].Italic = true
	return ed
}

func buildMarkdown(u *ui.Theme, ed *editor.Theme, s Settings) *markdown.Theme {
	size := s.BaseFontSize
	if size <= 0 {
		size = 14.5
	}
	code := ed.Tokens[editor.TokenCode].Color
	if code == (ui.Color{}) {
		code = ed.Text
	}
	return &markdown.Theme{
		FontSize:            size,
		Font:                s.TextFont,
		CodeFont:            s.EffectiveMonoFont(),
		LineHeight:          1.65,
		CodeLineHeight:      1.55,
		Text:                ed.Text,
		Muted:               u.TextMuted,
		Link:                u.Accent,
		Strong:              ed.Text,
		StrongWeight:        600,
		Code:                code,
		CodeBackground:      u.SurfaceHover,
		CodeSize:            0.875,
		QuoteBar:            u.Border,
		QuoteText:           u.TextMuted,
		Rule:                u.Border,
		CodeBlockBackground: u.Surface,
		CodeBlockBorder:     u.Border,
		TableBorder:         u.Border,
		TableHeader:         u.Surface,
		Checkbox:            u.Accent,
		BlockSpacing:        0.8,
		ItemSpacing:         0.3,
		ListIndent:          1.6,
		QuoteBarWidth:       3,
		CodeBlockRadius:     6,
		CodeBlockPadding:    0.9,
		CodeColors:          ed,
	}
}

func buildTerminal(t Theme, u *ui.Theme) *terminal.Theme {
	term := terminal.LightTheme()
	if t.Dark {
		term = terminal.DarkTheme()
	}
	term.Foreground, term.Background = u.Text, u.Background
	if t.Terminal != nil {
		term.Palette = *t.Terminal
	}
	return term
}

func applyAccent(t *ui.Theme, c ui.Color) {
	r, g, b := int(c.R), int(c.G), int(c.B)
	t.Accent = c
	t.AccentHover = ui.RGBA(uint8(min(255, r+18)), uint8(min(255, g+18)), uint8(min(255, b+18)), 1)
	t.AccentPressed = ui.RGBA(uint8(max(0, r-18)), uint8(max(0, g-18)), uint8(max(0, b-18)), 1)
	t.Focus = ui.RGBA(c.R, c.G, c.B, 0.35)
	if (r*299+g*587+b*114)/1000 >= 160 {
		t.AccentText = ui.Hex("#0c0c0c")
	} else {
		t.AccentText = ui.Hex("#fafafa")
	}
}
