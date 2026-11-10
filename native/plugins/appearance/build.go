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
	// zedSyntax are the Zed syntax keys of each token kind, the first a
	// scheme sets winning (RFC 0004 §6).
	zedSyntax = map[editor.TokenKind][]string{
		editor.TokenKeyword: {"keyword"}, editor.TokenType: {"type"}, editor.TokenFunction: {"function"},
		editor.TokenVariable: {"variable"}, editor.TokenProperty: {"property"},
		editor.TokenConstant: {"constant", "boolean"}, editor.TokenNumber: {"number"}, editor.TokenString: {"string"},
		editor.TokenEscape: {"string.escape", "string.special"}, editor.TokenRegexp: {"string.regex"},
		editor.TokenComment: {"comment"}, editor.TokenOperator: {"operator"}, editor.TokenPunctuation: {"punctuation"},
		editor.TokenTag: {"tag"}, editor.TokenAttribute: {"attribute"}, editor.TokenMeta: {"preproc", "attribute"},
		editor.TokenHeading: {"title"}, editor.TokenEmphasis: {"emphasis"}, editor.TokenStrong: {"emphasis.strong"},
		editor.TokenLink: {"link_text", "link_uri"}, editor.TokenCode: {"text.literal"},
		editor.TokenInserted: {"diff.plus"}, editor.TokenDeleted: {"diff.minus"},
	}
	ansiNames = [...]string{"black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"}
)

// built are the widget themes one Theme, its editor colors and the
// settings make; errs are the token overrides that did not resolve.
type built struct {
	ui       *ui.Theme
	tokens   *aui.Tokens
	acard    *acard.Tokens
	editor   *editor.Theme
	markdown *markdown.Theme
	terminal *terminal.Theme
	errs     []string
}

func build(t Theme, sch *Scheme, s Settings) built {
	accent, _ := aui.ParseColor(s.AccentColor)
	k, errs := tokens(t, accent)
	u := project(k, t.Dark, s)
	ed := buildEditor(u, k, sch, s)
	return built{ui: u, tokens: k, acard: acardOf(k, u), editor: ed, markdown: buildMarkdown(k, ed, sch, s),
		terminal: buildTerminal(k, sch, t.Dark), errs: errs}
}

// project is the *ui.Theme MyGo's widgets read: the tokens it has fields
// for (RFC 0004 §8), and the sizes and font of the settings.
func project(k *aui.Tokens, dark bool, s Settings) *ui.Theme {
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
	u.Radius, u.Spacing, u.FontSize, u.ScrollbarWidth = 10, 8, 14, 4
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

func buildEditor(u *ui.Theme, k *aui.Tokens, sch *Scheme, s Settings) *editor.Theme {
	ed := editor.DefaultTheme(u)
	ed.LineNumber = k.TextTertiary
	ed.Error, ed.Warning, ed.Info, ed.Hint = k.Error, k.Warning, k.Info, k.TextTertiary
	ed.Added, ed.Deleted, ed.Modified = k.Success, k.Error, k.Warning
	ed.Tokens[editor.TokenHeading].Color = k.Text
	ed.Tokens[editor.TokenLink].Color = k.TextLink
	ed.Tokens[editor.TokenInserted].Color = k.Success
	ed.Tokens[editor.TokenDeleted].Color = k.Error
	ed.Tokens[editor.TokenInvalid].Color = k.Error
	if sch != nil {
		applyZed(ed, sch.style)
	}
	ed.Tokens[editor.TokenComment].Italic = ed.Tokens[editor.TokenComment].Italic || s.ItalicComments
	ed.Tokens[editor.TokenHeading].Bold = true
	ed.Tokens[editor.TokenStrong].Bold = true
	ed.Tokens[editor.TokenEmphasis].Italic = true
	return ed
}

// applyZed sets what a Zed style sets of ed (RFC 0004 §6).
func applyZed(ed *editor.Theme, style map[string]any) {
	for _, f := range []struct {
		key string
		dst *ui.Color
	}{
		{"editor.background", &ed.Background}, {"editor.foreground", &ed.Text},
		{"editor.line_number", &ed.LineNumber}, {"editor.active_line_number", &ed.ActiveLineNumber},
		{"editor.active_line.background", &ed.ActiveLine},
		{"editor.document_highlight.bracket_background", &ed.MatchingBracket},
		{"search.match_background", &ed.Match}, {"editor.document_highlight.read_background", &ed.Occurrence},
		{"editor.indent_guide", &ed.IndentGuide}, {"editor.indent_guide_active", &ed.ActiveIndentGuide},
		{"editor.wrap_guide", &ed.WrapGuide}, {"editor.invisible", &ed.Whitespace},
		{"error", &ed.Error}, {"warning", &ed.Warning}, {"info", &ed.Info}, {"hint", &ed.Hint},
		{"created", &ed.Added}, {"deleted", &ed.Deleted}, {"modified", &ed.Modified},
	} {
		if c, ok := zedColor(style[f.key]); ok {
			*f.dst = c
		}
	}
	if _, ok := zedColor(style["search.match_background"]); ok {
		ed.CurrentMatch = ed.Match.Alpha(2)
	}
	if players, ok := style["players"].([]any); ok && len(players) > 0 {
		if p, ok := players[0].(map[string]any); ok {
			if c, ok := zedColor(p["cursor"]); ok {
				ed.Cursor = c
			}
			if c, ok := zedColor(p["selection"]); ok {
				ed.Selection, ed.InactiveSelection = c, c.Alpha(0.5)
			}
		}
	}
	if _, ok := zedColor(style["editor.foreground"]); ok {
		ed.Tokens[editor.TokenText].Color = ed.Text
	}
	for kind, status := range map[editor.TokenKind]string{
		editor.TokenInserted: "created", editor.TokenDeleted: "deleted", editor.TokenInvalid: "error",
	} {
		if c, ok := zedColor(style[status]); ok {
			ed.Tokens[kind].Color = c
		}
	}
	syntax, _ := style["syntax"].(map[string]any)
	for kind, keys := range zedSyntax {
		for _, key := range keys {
			if st, ok := zedHighlight(syntax[key]); ok {
				ed.Tokens[kind] = st
				break
			}
		}
	}
}

// zedHighlight reads a Zed syntax style: its color, italic font_style,
// and a font_weight of 600 or more as bold.
func zedHighlight(v any) (editor.TokenStyle, bool) {
	m, ok := v.(map[string]any)
	if !ok {
		return editor.TokenStyle{}, false
	}
	c, ok := zedColor(m["color"])
	if !ok {
		return editor.TokenStyle{}, false
	}
	weight, _ := m["font_weight"].(float64)
	return editor.TokenStyle{Color: c, Italic: m["font_style"] == "italic", Bold: weight >= 600}, true
}

func zedColor(v any) (ui.Color, bool) {
	s, ok := v.(string)
	if !ok {
		return ui.Color{}, false
	}
	return aui.ParseColor(s)
}

func buildMarkdown(k *aui.Tokens, ed *editor.Theme, sch *Scheme, s Settings) *markdown.Theme {
	size := s.BaseFontSize
	if size <= 0 {
		size = 14.5
	}
	code := ed.Tokens[editor.TokenCode].Color
	if code == (ui.Color{}) {
		code = ed.Text
	}
	block := k.FillHover.Over(k.BgPage)
	if sch != nil {
		if c, ok := zedColor(sch.style["editor.background"]); ok {
			block = c
		}
	}
	return &markdown.Theme{
		FontSize:            size,
		Font:                s.TextFont,
		CodeFont:            s.EffectiveMonoFont(),
		LineHeight:          1.65,
		CodeLineHeight:      1.55,
		Text:                k.Text,
		Muted:               k.TextSecondary,
		Link:                k.TextLink,
		Strong:              k.Text,
		StrongWeight:        600,
		Code:                code,
		CodeBackground:      k.FillHover,
		CodeSize:            0.875,
		QuoteBar:            k.Border,
		QuoteText:           k.TextSecondary,
		Rule:                k.Border,
		CodeBlockBackground: block,
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

func buildTerminal(k *aui.Tokens, sch *Scheme, dark bool) *terminal.Theme {
	term := terminal.LightTheme()
	if dark {
		term = terminal.DarkTheme()
	}
	term.Foreground, term.Background = k.Text, k.BgPage
	if sch == nil {
		return term
	}
	for _, f := range []struct {
		keys []string
		dst  *ui.Color
	}{
		{[]string{"terminal.foreground", "editor.foreground"}, &term.Foreground},
		{[]string{"terminal.background", "editor.background"}, &term.Background},
	} {
		for _, key := range f.keys {
			if c, ok := zedColor(sch.style[key]); ok {
				*f.dst = c
				break
			}
		}
	}
	var palette [16]ui.Color
	for i := range palette {
		prefix := "terminal.ansi."
		if i >= 8 {
			prefix = "terminal.ansi.bright_"
		}
		c, ok := zedColor(sch.style[prefix+ansiNames[i%8]])
		if !ok {
			return term
		}
		palette[i] = c
	}
	term.Palette = palette
	return term
}
