package appearance

import (
	"cmp"

	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
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
	// DefaultLightTheme is the default light theme, base46's.
	DefaultLightTheme = "one_light"
	// DefaultDarkTheme is the default dark theme, base46's.
	DefaultDarkTheme = "onedark"
	// DefaultDensity is the density of an empty appearance.json.
	DefaultDensity = "compact"
)

// densities are Alma's three densities over the compact sizes: a control
// and a row grow by Alma's 0.25rem steps, the spacing by its card
// paddings' ratios (1.25, 1.5, 1.75rem) and the reading line height by
// its line heights' steps (1.4, 1.5, 1.65).
var densities = map[string]density{
	"compact":     {step: 0, spacing: 8, lineHeight: 1.65},
	"comfortable": {step: 4, spacing: 10, lineHeight: 1.75},
	"spacious":    {step: 8, spacing: 11, lineHeight: 1.9},
}

// density is how roomy the interface is: step the DIPs a control and a
// row grow by over compact, spacing the ui.Theme's spacing unit and
// lineHeight the reading view's.
type density struct {
	step, spacing, lineHeight float32
}

// Settings are appearance.json's values (docs/appearance.md).
type Settings struct {
	Theme          string
	LightTheme     string
	DarkTheme      string
	Density        string
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
	ShowInline     bool
	ShowFileIcons  bool
	Radius         float32
	ScrollbarWidth float32
}

// DefaultSettings are the settings of an empty appearance.json.
func DefaultSettings() Settings {
	return Settings{
		Theme:          "system",
		LightTheme:     DefaultLightTheme,
		DarkTheme:      DefaultDarkTheme,
		Density:        DefaultDensity,
		IconTheme:      "pierre",
		BaseFontSize:   14,
		EditorFontSize: CodeFontSize,
		TabSize:        4,
		LineHeightMode: "comfortable",
		CustomLineH:    1.5,
		ShowLineNums:   true,
		ShowGuides:     true,
		ShowFileIcons:  true,
		Radius:         10,
		ScrollbarWidth: 4,
	}
}

// EffectiveMonoFont returns MonospaceFont, or MonoFont when unset.
func (s Settings) EffectiveMonoFont() string {
	return cmp.Or(s.MonospaceFont, MonoFont)
}

// EffectiveEditorFontSize returns EditorFontSize clamped to [10, 30].
func (s Settings) EffectiveEditorFontSize() float32 {
	if s.EditorFontSize >= 10 && s.EditorFontSize <= 30 {
		return s.EditorFontSize
	}
	return CodeFontSize
}

// EffectiveTabSize returns TabSize clamped to [1, 8].
func (s Settings) EffectiveTabSize() int {
	if s.TabSize >= 1 && s.TabSize <= 8 {
		return s.TabSize
	}
	return 4
}

// EffectiveLineHeight returns the editor line height ratio.
func (s Settings) EffectiveLineHeight() float32 {
	switch s.LineHeightMode {
	case "standard":
		return StandardLineHeight
	case "custom":
		if s.CustomLineH >= 1.0 && s.CustomLineH <= 2.5 {
			return s.CustomLineH
		}
		return 1.5
	default:
		return CodeLineHeight
	}
}

func (s Settings) density() density {
	if d, ok := densities[s.Density]; ok {
		return d
	}
	return densities[DefaultDensity]
}

func load(set *settings.Settings) Settings {
	s := DefaultSettings()
	if set == nil {
		return s
	}
	for key, dst := range map[string]any{
		"theme":               &s.Theme,
		"lightTheme":          &s.LightTheme,
		"darkTheme":           &s.DarkTheme,
		"density":             &s.Density,
		"iconTheme":           &s.IconTheme,
		"interfaceFontFamily": &s.InterfaceFont,
		"textFontFamily":      &s.TextFont,
		"monospaceFontFamily": &s.MonospaceFont,
		"baseFontSize":        &s.BaseFontSize,
		"editorFontSize":      &s.EditorFontSize,
		"tabSize":             &s.TabSize,
		"lineHeight":          &s.LineHeightMode,
		"customLineHeight":    &s.CustomLineH,
		"italicComments":      &s.ItalicComments,
		"showLineNumbers":     &s.ShowLineNums,
		"showIndentGuides":    &s.ShowGuides,
		"showInlineTitle":     &s.ShowInline,
		"showFileIcons":       &s.ShowFileIcons,
		"radius":              &s.Radius,
		"scrollbarWidth":      &s.ScrollbarWidth,
	} {
		set.Get(settings.Appearance, key, dst)
	}
	return s
}
