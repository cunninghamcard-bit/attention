package textdoc

import (
	"cmp"
	"embed"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"

	"github.com/cunninghamcard-bit/attention-ui/theme"
	"github.com/cunninghamcard-bit/attention/native/internal/fileicon"
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
)

const (
	// MonoFont is the coding font stack for text and markdown code blocks.
	MonoFont = "Zed Mono, JetBrains Mono, Berkeley Mono, SF Mono, Menlo, monospace"
	// CodeFontSize is Zed's default buffer font size in DIPs.
	CodeFontSize float32 = 14
	// CodeLineHeight is Zed's comfortable golden-ratio buffer line height.
	CodeLineHeight float32 = 1.618
	// StandardLineHeight is Zed's compact buffer line height.
	StandardLineHeight float32 = 1.3
	// DefaultLightTheme is the default light theme loaded from themes/attention.json.
	DefaultLightTheme = "Attention Light"
	// DefaultDarkTheme is the default dark theme loaded from themes/attention.json.
	DefaultDarkTheme = "Attention Dark"
)

var (
	//go:embed themes/*.json
	builtinThemes embed.FS

	appearanceMu sync.RWMutex
	currentApp   = DefaultAppearance()
	themesLoaded bool
	themeCatalog = map[string]ThemeEntry{}
	cachedKey    styleKey
	lightUI      *ui.Theme
	darkUI       *ui.Theme
	lightEd      *editor.Theme
	darkEd       *editor.Theme
	lightMD      *markdown.Theme
	darkMD       *markdown.Theme
)

type themeFamilyFile struct {
	Name   string       `json:"name"`
	Author string       `json:"author"`
	Themes []ThemeEntry `json:"themes"`
}

// ThemeEntry is a single light or dark theme parsed from a Zed theme JSON file.
type ThemeEntry struct {
	Name       string     `json:"name"`
	Appearance string     `json:"appearance"`
	Style      themeStyle `json:"style"`
}

type syntaxToken struct {
	Color      string `json:"color"`
	FontStyle  string `json:"font_style"`
	FontWeight int    `json:"font_weight"`
}

type playerColor struct {
	Cursor     string `json:"cursor"`
	Background string `json:"background"`
	Selection  string `json:"selection"`
}

type themeStyle struct {
	Border            string                 `json:"border"`
	BorderVariant     string                 `json:"border.variant"`
	BorderFocused     string                 `json:"border.focused"`
	ElevatedSurface   string                 `json:"elevated_surface.background"`
	Surface           string                 `json:"surface.background"`
	Background        string                 `json:"background"`
	ElementBackground string                 `json:"element.background"`
	ElementHover      string                 `json:"element.hover"`
	ElementActive     string                 `json:"element.active"`
	ElementSelected   string                 `json:"element.selected"`
	GhostHover        string                 `json:"ghost_element.hover"`
	GhostActive       string                 `json:"ghost_element.active"`
	GhostSelected     string                 `json:"ghost_element.selected"`
	Text              string                 `json:"text"`
	TextMuted         string                 `json:"text.muted"`
	TextPlaceholder   string                 `json:"text.placeholder"`
	TextAccent        string                 `json:"text.accent"`
	StatusBar         string                 `json:"status_bar.background"`
	TitleBar          string                 `json:"title_bar.background"`
	Toolbar           string                 `json:"toolbar.background"`
	TabBar            string                 `json:"tab_bar.background"`
	TabInactive       string                 `json:"tab.inactive_background"`
	TabActive         string                 `json:"tab.active_background"`
	SearchMatch       string                 `json:"search.match_background"`
	SearchActiveMatch string                 `json:"search.active_match_background"`
	PanelBackground   string                 `json:"panel.background"`
	ScrollbarThumb    string                 `json:"scrollbar.thumb.background"`
	EditorForeground  string                 `json:"editor.foreground"`
	EditorBackground  string                 `json:"editor.background"`
	EditorGutter      string                 `json:"editor.gutter.background"`
	EditorActiveLine  string                 `json:"editor.active_line.background"`
	EditorLineNumber  string                 `json:"editor.line_number"`
	EditorActiveLineN string                 `json:"editor.active_line_number"`
	EditorInvisible   string                 `json:"editor.invisible"`
	EditorWrapGuide   string                 `json:"editor.wrap_guide"`
	EditorActiveWrap  string                 `json:"editor.active_wrap_guide"`
	EditorDocRead     string                 `json:"editor.document_highlight.read_background"`
	VCAdded           string                 `json:"version_control.added"`
	VCModified        string                 `json:"version_control.modified"`
	VCDeleted         string                 `json:"version_control.deleted"`
	Error             string                 `json:"error"`
	Warning           string                 `json:"warning"`
	Info              string                 `json:"info"`
	Hint              string                 `json:"hint"`
	Success           string                 `json:"success"`
	Created           string                 `json:"created"`
	Players           []playerColor          `json:"players"`
	Syntax            map[string]syntaxToken `json:"syntax"`
}

type styleKey struct {
	lightTheme     string
	darkTheme      string
	accent         string
	accentColor    string
	italicComments bool
	interfaceFont  string
	textFont       string
	monoFont       string
	baseFontSize   float32
	spacing        float32
	radius         float32
	scrollbarWidth float32
}

// Appearance holds the user's v1 appearance settings (docs/appearance.md).
type Appearance struct {
	Theme          string
	LightTheme     string
	DarkTheme      string
	Accent         string
	AccentColor    string
	IconTheme      string
	InterfaceFont  string
	TextFont       string
	MonospaceFont  string
	BaseFontSize   float32
	EditorFontSize float32
	TabSize        int
	LineHeightMode string
	CustomLineH    float32
	ItalicComments bool
	ShowLineNums   bool
	ShowGuides     bool
	ShowRibbon     bool
	ShowViewHeader bool
	ShowInline     bool
	ShowTabBar     bool
	ShowFileIcons  bool
	TreeDensity    string
	Spacing        float32
	Radius         float32
	ScrollbarWidth float32
}

// EffectiveMonoFont returns MonospaceFont, or MonoFont when unset.
func (a Appearance) EffectiveMonoFont() string {
	return cmp.Or(a.MonospaceFont, MonoFont)
}

// EffectiveEditorFontSize returns EditorFontSize clamped to [10, 30].
func (a Appearance) EffectiveEditorFontSize() float32 {
	if a.EditorFontSize >= 10 && a.EditorFontSize <= 30 {
		return a.EditorFontSize
	}
	return CodeFontSize
}

// EffectiveTabSize returns TabSize clamped to [1, 8].
func (a Appearance) EffectiveTabSize() int {
	if a.TabSize >= 1 && a.TabSize <= 8 {
		return a.TabSize
	}
	return 4
}

// EffectiveLineHeight returns the editor line height ratio.
func (a Appearance) EffectiveLineHeight() float32 {
	switch a.LineHeightMode {
	case "standard":
		return StandardLineHeight
	case "custom":
		if a.CustomLineH >= 1.0 && a.CustomLineH <= 2.5 {
			return a.CustomLineH
		}
		return 1.5
	default:
		return CodeLineHeight
	}
}

// DefaultAppearance returns the default v1 appearance configuration.
func DefaultAppearance() Appearance {
	return Appearance{
		Theme:          "system",
		LightTheme:     DefaultLightTheme,
		DarkTheme:      DefaultDarkTheme,
		Accent:         "default",
		IconTheme:      "pierre",
		BaseFontSize:   14,
		EditorFontSize: CodeFontSize,
		TabSize:        4,
		LineHeightMode: "comfortable",
		CustomLineH:    1.5,
		ItalicComments: false,
		ShowLineNums:   true,
		ShowGuides:     true,
		ShowRibbon:     true,
		ShowViewHeader: true,
		ShowInline:     false,
		ShowTabBar:     true,
		ShowFileIcons:  true,
		TreeDensity:    "standard",
		Spacing:        8,
		Radius:         8,
		ScrollbarWidth: 4,
	}
}

// CurrentAppearance returns the active appearance settings.
func CurrentAppearance() Appearance {
	appearanceMu.RLock()
	defer appearanceMu.RUnlock()
	return currentApp
}

// SetAppearance updates the active appearance settings.
func SetAppearance(a Appearance) {
	appearanceMu.Lock()
	currentApp = a
	appearanceMu.Unlock()
	fileicon.SetMode(a.ShowFileIcons, a.IconTheme)
}

// ThemesDir returns the user theme directory (<configDir>/themes) where custom
// Zed theme JSON files can be placed.
func ThemesDir() string {
	return filepath.Join(paths.ConfigDir(), "themes")
}

// ReloadThemes loads embedded theme JSON files and user theme JSON files from
// ThemesDir().
func ReloadThemes() {
	appearanceMu.Lock()
	defer appearanceMu.Unlock()
	loadThemesLocked()
	cachedKey = styleKey{}
}

// AvailableThemes returns the sorted list of available theme names for light or
// dark appearance, discovered from embedded and user theme JSON files.
func AvailableThemes(dark bool) []string {
	appearanceMu.Lock()
	if !themesLoaded {
		loadThemesLocked()
	}
	want := "light"
	if dark {
		want = "dark"
	}
	var names []string
	for _, t := range themeCatalog {
		if t.Appearance == want {
			names = append(names, t.Name)
		}
	}
	appearanceMu.Unlock()
	slices.Sort(names)
	if dark {
		names = append(names, "GitHub Dark")
	} else {
		names = append(names, "GitHub Light")
	}
	return names
}

// UITheme returns the configured light or dark window theme.
func UITheme(dark bool) *ui.Theme {
	ensureThemes()
	appearanceMu.RLock()
	defer appearanceMu.RUnlock()
	if dark {
		return darkUI
	}
	return lightUI
}

// CodeTheme returns the configured light or dark editor theme.
func CodeTheme(dark bool) *editor.Theme {
	ensureThemes()
	appearanceMu.RLock()
	defer appearanceMu.RUnlock()
	if dark {
		return darkEd
	}
	return lightEd
}

// MarkdownTheme returns the configured light or dark markdown theme.
func MarkdownTheme(dark bool) *markdown.Theme {
	ensureThemes()
	appearanceMu.RLock()
	defer appearanceMu.RUnlock()
	if dark {
		return darkMD
	}
	return lightMD
}

// NormalizeHexColor normalizes "#rgb" or "#rrggbb" to lowercase "#rrggbb", or "".
func NormalizeHexColor(raw string) string {
	s := strings.TrimSpace(strings.TrimPrefix(raw, "#"))
	if len(s) == 3 {
		s = string([]byte{s[0], s[0], s[1], s[1], s[2], s[2]})
	}
	if len(s) != 6 {
		return ""
	}
	for i := 0; i < 6; i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') && (c < 'A' || c > 'F') {
			return ""
		}
	}
	return "#" + strings.ToLower(s)
}

func loadThemesLocked() {
	themesLoaded = true
	clear(themeCatalog)
	entries, _ := fs.ReadDir(builtinThemes, "themes")
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			if data, err := builtinThemes.ReadFile("themes/" + e.Name()); err == nil {
				parseThemeJSON(data)
			}
		}
	}
	userEntries, err := os.ReadDir(ThemesDir())
	if err != nil {
		return
	}
	for _, e := range userEntries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			if data, err := os.ReadFile(filepath.Join(ThemesDir(), e.Name())); err == nil {
				parseThemeJSON(data)
			}
		}
	}
}

func parseThemeJSON(data []byte) {
	var fam themeFamilyFile
	if err := json.Unmarshal(data, &fam); err != nil {
		return
	}
	for _, t := range fam.Themes {
		if t.Name != "" && (t.Appearance == "light" || t.Appearance == "dark") {
			themeCatalog[t.Name] = t
		}
	}
}

func ensureThemes() {
	appearanceMu.Lock()
	defer appearanceMu.Unlock()
	if !themesLoaded {
		loadThemesLocked()
	}
	a := currentApp
	k := styleKey{
		lightTheme:     cmp.Or(a.LightTheme, DefaultLightTheme),
		darkTheme:      cmp.Or(a.DarkTheme, DefaultDarkTheme),
		accent:         cmp.Or(a.Accent, "default"),
		accentColor:    NormalizeHexColor(a.AccentColor),
		italicComments: a.ItalicComments,
		interfaceFont:  a.InterfaceFont,
		textFont:       a.TextFont,
		monoFont:       a.EffectiveMonoFont(),
		baseFontSize:   a.BaseFontSize,
		spacing:        a.Spacing,
		radius:         a.Radius,
		scrollbarWidth: a.ScrollbarWidth,
	}
	if lightEd != nil && cachedKey == k {
		return
	}
	cachedKey = k
	lightEntry, hasLight := themeCatalog[k.lightTheme]
	if !hasLight && k.lightTheme != "GitHub Light" {
		lightEntry, hasLight = themeCatalog[DefaultLightTheme]
	}
	darkEntry, hasDark := themeCatalog[k.darkTheme]
	if !hasDark && k.darkTheme != "GitHub Dark" {
		darkEntry, hasDark = themeCatalog[DefaultDarkTheme]
	}
	lightUI = buildUITheme(false, lightEntry, hasLight, k)
	darkUI = buildUITheme(true, darkEntry, hasDark, k)
	lightEd = buildEditorTheme(false, lightUI, lightEntry, hasLight, k.italicComments)
	darkEd = buildEditorTheme(true, darkUI, darkEntry, hasDark, k.italicComments)
	lightMD = buildMarkdownTheme(lightUI, lightEd, k)
	darkMD = buildMarkdownTheme(darkUI, darkEd, k)
}

func buildUITheme(dark bool, entry ThemeEntry, ok bool, k styleKey) *ui.Theme {
	t := theme.For(dark, k.accent)
	if ok {
		st := entry.Style
		setColor(&t.Background, st.EditorBackground, st.Background)
		setColor(&t.Surface, st.PanelBackground, st.Surface, st.ElevatedSurface)
		setColor(&t.SurfaceHover, st.ElementHover, st.GhostHover)
		setColor(&t.SurfacePressed, st.ElementSelected, st.ElementActive, st.GhostSelected)
		setColor(&t.Border, st.BorderVariant, st.Border)
		setColor(&t.Text, st.Text, st.EditorForeground)
		setColor(&t.TextMuted, st.TextMuted, st.TextPlaceholder)
		setColor(&t.Scrollbar, st.ScrollbarThumb)
		setColor(&t.Danger, st.Error, st.VCDeleted)
		setColor(&t.Warning, st.Warning, st.VCModified)
		setColor(&t.Success, st.Success, st.Created, st.VCAdded)
		if k.accent == "default" {
			if c, valid := parseColor(st.TextAccent); valid {
				applyAccent(t, c)
			}
		}
		if len(st.Players) > 0 {
			setColor(&t.Selection, st.Players[0].Selection)
		}
	}
	if k.accentColor != "" {
		if c, valid := parseColor(k.accentColor); valid {
			applyAccent(t, c)
		}
	}
	if k.interfaceFont != "" {
		t.Font = k.interfaceFont
	}
	if k.baseFontSize >= 10 && k.baseFontSize <= 30 {
		t.FontSize = k.baseFontSize
	}
	if k.spacing >= 2 && k.spacing <= 16 {
		t.Spacing = k.spacing
	}
	if k.radius >= 0 && k.radius <= 20 {
		t.Radius = k.radius
	}
	if k.scrollbarWidth >= 2 && k.scrollbarWidth <= 14 {
		t.ScrollbarWidth = k.scrollbarWidth
	}
	return t
}

func buildEditorTheme(dark bool, base *ui.Theme, entry ThemeEntry, ok bool, italicComments bool) *editor.Theme {
	ct := editor.DefaultTheme(base)
	if !ok {
		ct.Tokens[editor.TokenComment].Italic = italicComments
		return ct
	}
	st := entry.Style
	setColor(&ct.Background, st.EditorBackground, st.Background)
	setColor(&ct.Text, st.EditorForeground, st.Text)
	setColor(&ct.LineNumber, st.EditorLineNumber)
	setColor(&ct.ActiveLineNumber, st.EditorActiveLineN)
	setColor(&ct.ActiveLine, st.EditorActiveLine)
	if len(st.Players) > 0 {
		setColor(&ct.Cursor, st.Players[0].Cursor)
		if sel, ok := parseColor(st.Players[0].Selection); ok {
			ct.Selection = sel
			ct.InactiveSelection = sel.Alpha(0.55)
			ct.MatchingBracket = sel
		}
	}
	setColor(&ct.Match, st.SearchMatch)
	setColor(&ct.CurrentMatch, st.SearchActiveMatch)
	setColor(&ct.Occurrence, st.EditorDocRead)
	setColor(&ct.IndentGuide, st.EditorWrapGuide, st.BorderVariant)
	setColor(&ct.WrapGuide, st.EditorWrapGuide, st.BorderVariant)
	setColor(&ct.ActiveIndentGuide, st.EditorActiveWrap, st.Border)
	setColor(&ct.Whitespace, st.EditorInvisible)
	setColor(&ct.Error, st.Error)
	setColor(&ct.Warning, st.Warning)
	setColor(&ct.Info, st.Info)
	setColor(&ct.Hint, st.Hint)
	setColor(&ct.Added, st.VCAdded, st.Created)
	setColor(&ct.Deleted, st.VCDeleted, st.Error)
	setColor(&ct.Modified, st.VCModified, st.Warning)

	// Clear DefaultTheme's GitHub token colors before applying the file's syntax map.
	ct.Tokens = [len(ct.Tokens)]editor.TokenStyle{}
	applyTok := func(k editor.TokenKind, keys ...string) {
		for _, key := range keys {
			tok, exists := st.Syntax[key]
			if !exists {
				continue
			}
			if c, valid := parseColor(tok.Color); valid {
				ct.Tokens[k] = editor.TokenStyle{
					Color:  c,
					Italic: tok.FontStyle == "italic",
					Bold:   tok.FontWeight >= 600,
				}
				return
			}
		}
	}
	applyTok(editor.TokenText, "primary")
	applyTok(editor.TokenVariable, "variable")
	applyTok(editor.TokenKeyword, "keyword")
	applyTok(editor.TokenOperator, "operator")
	applyTok(editor.TokenType, "type", "enum")
	applyTok(editor.TokenFunction, "function", "constructor")
	applyTok(editor.TokenProperty, "property")
	applyTok(editor.TokenConstant, "constant", "boolean")
	applyTok(editor.TokenNumber, "number")
	applyTok(editor.TokenString, "string")
	applyTok(editor.TokenEscape, "string.escape")
	applyTok(editor.TokenRegexp, "string.regex", "string.special")
	applyTok(editor.TokenComment, "comment", "comment.doc")
	applyTok(editor.TokenPunctuation, "punctuation.bracket", "punctuation.delimiter", "punctuation")
	applyTok(editor.TokenTag, "tag")
	applyTok(editor.TokenAttribute, "attribute")
	applyTok(editor.TokenMeta, "preproc", "attribute")
	applyTok(editor.TokenHeading, "title")
	applyTok(editor.TokenEmphasis, "emphasis")
	applyTok(editor.TokenStrong, "emphasis.strong")
	applyTok(editor.TokenLink, "link_text", "link_uri")
	applyTok(editor.TokenCode, "text.literal")
	applyTok(editor.TokenInserted, "diff.plus")
	applyTok(editor.TokenDeleted, "diff.minus")
	setColor(&ct.Tokens[editor.TokenInvalid].Color, st.Error)

	if italicComments {
		ct.Tokens[editor.TokenComment].Italic = true
	}
	ct.Tokens[editor.TokenHeading].Bold = true
	ct.Tokens[editor.TokenStrong].Bold = true
	ct.Tokens[editor.TokenEmphasis].Italic = true
	return ct
}

func buildMarkdownTheme(uith *ui.Theme, ct *editor.Theme, k styleKey) *markdown.Theme {
	size := k.baseFontSize
	if size <= 0 {
		size = 14.5
	}
	linkColor := ct.Tokens[editor.TokenLink].Color
	if linkColor == (ui.Color{}) {
		linkColor = uith.Accent
	}
	codeColor := ct.Tokens[editor.TokenProperty].Color
	if codeColor == (ui.Color{}) {
		codeColor = ct.Text
	}
	return &markdown.Theme{
		FontSize:            size,
		Font:                k.textFont,
		CodeFont:            k.monoFont,
		LineHeight:          1.65,
		CodeLineHeight:      1.55,
		Text:                ct.Text,
		Muted:               uith.TextMuted,
		Link:                linkColor,
		Strong:              ct.Text,
		StrongWeight:        600,
		Code:                codeColor,
		CodeBackground:      uith.SurfaceHover,
		CodeSize:            0.875,
		QuoteBar:            uith.Border,
		QuoteText:           uith.TextMuted,
		Rule:                uith.Border,
		CodeBlockBackground: uith.Surface,
		CodeBlockBorder:     uith.Border,
		TableBorder:         uith.Border,
		TableHeader:         uith.Surface,
		Checkbox:            uith.Accent,
		BlockSpacing:        0.8,
		ItemSpacing:         0.3,
		ListIndent:          1.6,
		QuoteBarWidth:       3,
		CodeBlockRadius:     6,
		CodeBlockPadding:    0.9,
		CodeColors:          ct,
	}
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

func setColor(dst *ui.Color, candidates ...string) {
	for _, raw := range candidates {
		if c, ok := parseColor(raw); ok {
			*dst = c
			return
		}
	}
}

func parseColor(raw string) (ui.Color, bool) {
	h := strings.TrimPrefix(strings.TrimSpace(raw), "#")
	if len(h) != 6 && len(h) != 8 {
		return ui.Color{}, false
	}
	r, err1 := strconv.ParseUint(h[0:2], 16, 8)
	g, err2 := strconv.ParseUint(h[2:4], 16, 8)
	b, err3 := strconv.ParseUint(h[4:6], 16, 8)
	if err1 != nil || err2 != nil || err3 != nil {
		return ui.Color{}, false
	}
	a := uint64(255)
	if len(h) == 8 {
		var err4 error
		a, err4 = strconv.ParseUint(h[6:8], 16, 8)
		if err4 != nil || a == 0 {
			return ui.Color{}, false
		}
	}
	return ui.Color{R: uint8(r), G: uint8(g), B: uint8(b), A: uint8(a)}, true
}
