package appearance

import (
	acard "github.com/cunninghamcard-bit/acard-ui/tokens"
	"github.com/egoist/mygo/plugins/terminal"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"

	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

var (
	// syntax are the base_16 colors of the kinds of tokens, as base46's
	// integrations/syntax.lua and treesitter.lua color them (attention#11).
	syntax = map[editor.TokenKind]int{
		editor.TokenText: 5, editor.TokenKeyword: 0xE, editor.TokenFunction: 0xD,
		editor.TokenType: 0xA, editor.TokenTag: 0xA, editor.TokenAttribute: 0xA, editor.TokenMeta: 0xA,
		editor.TokenString: 0xB, editor.TokenNumber: 9, editor.TokenConstant: 9, editor.TokenProperty: 8,
		editor.TokenEscape: 0xC, editor.TokenRegexp: 0xC, editor.TokenVariable: 5, editor.TokenOperator: 5,
		editor.TokenPunctuation: 0xF, editor.TokenHeading: 0xD, editor.TokenLink: 8, editor.TokenCode: 9,
	}
	// ansi are the base_16 colors of the 16 ANSI colors, base46's term.lua.
	ansi = [16]int{1, 8, 0xB, 0xA, 0xD, 0xE, 0xC, 5, 3, 8, 0xB, 0xA, 0xD, 0xE, 0xC, 7}
)

// built are the widget themes one Theme and the settings make.
type built struct {
	ui       *ui.Theme
	tokens   *aui.Tokens
	acard    *acard.Tokens
	editor   *editor.Theme
	markdown *markdown.Theme
	terminal *terminal.Theme
}

func build(t Theme, s Settings) built {
	d := s.density()
	k := tokens(t, d)
	u := project(k, t.Dark, s, d)
	ed := buildEditor(u, k, t, s)
	return built{ui: u, tokens: k, acard: acardOf(k, u, d), editor: ed, markdown: buildMarkdown(k, ed, s, d),
		terminal: buildTerminal(k, t)}
}

// project is the *ui.Theme MyGo's widgets read: the tokens it has fields
// for (RFC 0004 §8), and the sizes and font of the settings.
func project(k *aui.Tokens, dark bool, s Settings, d density) *ui.Theme {
	u := ui.LightTheme()
	if dark {
		u = ui.DarkTheme()
	}
	u.Background, u.Surface, u.SurfaceHover, u.SurfacePressed = k.BgPage, k.BgWindow, k.FillHover, k.FillPressed
	u.Border, u.Text, u.TextMuted = k.Border, k.Text, k.TextSecondary
	u.Accent, u.AccentHover, u.AccentPressed, u.AccentText = k.AccentFill, k.AccentFillHover, k.AccentFillPressed, k.TextOnAccent
	u.Danger, u.Warning, u.Success = k.Error, k.Warning, k.Success
	u.Selection, u.Focus, u.Scrollbar = k.Selection, k.BorderFocus, k.Scrollbar
	u.Inverse, u.InverseText = k.BgInverse, k.TextInverse
	u.Radius, u.Spacing, u.FontSize, u.ScrollbarWidth = 10, d.spacing, 14, 4
	if s.InterfaceFont != "" {
		u.Font = s.InterfaceFont
	}
	if s.BaseFontSize >= 10 && s.BaseFontSize <= 30 {
		u.FontSize = s.BaseFontSize
	}
	if s.Radius >= 0 && s.Radius <= 20 {
		u.Radius = s.Radius
	}
	if s.ScrollbarWidth >= 2 && s.ScrollbarWidth <= 14 {
		u.ScrollbarWidth = s.ScrollbarWidth
	}
	return u
}

// buildEditor is the code editor's theme: attention#11's table over
// base_16 and base_30, from base46's Neovim highlights, on the page so
// that a buffer and its card are one surface.
func buildEditor(u *ui.Theme, k *aui.Tokens, t Theme, s Settings) *editor.Theme {
	b := t.base16
	ed := editor.DefaultTheme(u)
	ed.Background, ed.Text, ed.Cursor = k.BgPage, b[5], b[5]
	ed.LineNumber, ed.ActiveLineNumber, ed.ActiveLine = t.color("grey"), t.color("white"), t.color("black2")
	ed.Selection, ed.InactiveSelection = b[2], b[2].Alpha(0.6)
	ed.Match, ed.CurrentMatch, ed.Occurrence = b[0xA].Alpha(0.3), b[9].Alpha(0.45), b[2].Alpha(0.6)
	ed.MatchingBracket = t.color("grey")
	ed.IndentGuide, ed.ActiveIndentGuide, ed.WrapGuide = t.color("line"), t.color("grey"), t.color("line")
	ed.Whitespace = b[3]
	ed.Error, ed.Warning, ed.Info, ed.Hint = t.color("red"), t.color("yellow"), t.color("green"), t.color("purple")
	ed.Added, ed.Deleted, ed.Modified = t.color("green"), t.color("red"), t.color("yellow")
	clear(ed.Tokens[:])
	for kind, i := range syntax {
		ed.Tokens[kind].Color = b[i]
	}
	ed.Tokens[editor.TokenComment] = editor.TokenStyle{Color: t.color("grey_fg"), Italic: s.ItalicComments}
	ed.Tokens[editor.TokenInserted].Color = t.color("green")
	ed.Tokens[editor.TokenDeleted].Color = t.color("red")
	ed.Tokens[editor.TokenInvalid].Color = t.color("red")
	ed.Tokens[editor.TokenHeading].Bold = true
	ed.Tokens[editor.TokenStrong].Bold = true
	ed.Tokens[editor.TokenEmphasis].Italic = true
	return ed
}

func buildMarkdown(k *aui.Tokens, ed *editor.Theme, s Settings, d density) *markdown.Theme {
	size := s.BaseFontSize
	if size <= 0 {
		size = 14.5
	}
	return &markdown.Theme{
		FontSize:            size,
		Font:                s.TextFont,
		CodeFont:            s.EffectiveMonoFont(),
		LineHeight:          d.lineHeight,
		CodeLineHeight:      1.55,
		Text:                k.Text,
		Muted:               k.TextSecondary,
		Link:                k.TextLink,
		Strong:              k.Text,
		StrongWeight:        600,
		Code:                ed.Tokens[editor.TokenCode].Color,
		CodeBackground:      k.FillHover,
		CodeSize:            0.875,
		QuoteBar:            k.Border,
		QuoteText:           k.TextSecondary,
		Rule:                k.Border,
		CodeBlockBackground: k.FillHover.Over(k.BgPage),
		CodeBlockBorder:     k.BorderSubtle,
		TableBorder:         k.Border,
		TableHeader:         k.FillHover.Over(k.BgPage),
		Mark:                k.Highlight,
		Checkbox:            k.AccentFill,
		BlockSpacing:        0.8,
		ItemSpacing:         0.3,
		ListIndent:          1.6,
		QuoteBarWidth:       3,
		CodeBlockRadius:     6,
		CodeBlockPadding:    0.9,
		CodeColors:          ed,
	}
}

// buildTerminal is the terminal's theme: base46's term.lua colors on the
// page.
func buildTerminal(k *aui.Tokens, t Theme) *terminal.Theme {
	term := terminal.LightTheme()
	if t.Dark {
		term = terminal.DarkTheme()
	}
	term.Foreground, term.Background = t.base16[5], k.BgPage
	for i, b := range ansi {
		term.Palette[i] = t.base16[b]
	}
	return term
}
