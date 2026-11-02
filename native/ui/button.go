package ui

import (
	"github.com/egoist/mygo/ui"
)

const (
	// ButtonPrimary is the accent action; the zero value.
	ButtonPrimary ButtonVariant = iota
	// ButtonSecondary is the control face with a hairline ring.
	ButtonSecondary
	// ButtonGhost has no face until the pointer is over it.
	ButtonGhost
	// ButtonDanger is the solid danger action.
	ButtonDanger
	// ButtonLink is accent text with no face until the pointer is over it.
	ButtonLink

	// ButtonSM is a 32 DIP labelled button; the zero value.
	ButtonSM ButtonSize = 0
	// ButtonIconSmall is a 28 DIP square with a 14 DIP icon, named by Label.
	ButtonIconSmall ButtonSize = 1
	// ButtonIconTiny is a 24 DIP square with a 14 DIP icon, named by Label.
	ButtonIconTiny ButtonSize = 2
)

// ButtonVariant is the role of a button.
type ButtonVariant int

// ButtonSize is how big a button is.
type ButtonSize int

// ButtonProps describes a button.
type ButtonProps struct {
	// Label is the text, or the accessible name of an icon button.
	Label string
	// Icon is drawn before the label, or alone in an icon size; any
	// *ui.SVG works, a file-type icon as well as icon.Must's.
	Icon    *ui.SVG
	Variant ButtonVariant
	Size    ButtonSize
	// Disabled dims the button and ignores clicks.
	Disabled bool
	// IconColor tints Icon; the zero color follows the text.
	IconColor ui.Color
	OnClick   func()
}

// Button draws a button (port of omgui.Button, without its GitHub
// variants, and of CrychicUI's button minus the press scale and sounds).
func Button(c *ui.Context, p ButtonProps) ui.Element {
	t := c.Theme()
	b := ui.ButtonBase(c).Gap(6).AlignItems(ui.Center).Justify(ui.Center).
		Radius(controlRadius(t)).Cursor(ui.CursorPointer)
	glyph := iconSize
	iconOnly := p.Size != ButtonSM
	switch p.Size {
	case ButtonIconSmall:
		b.Size(28, 28)
		glyph = iconSmall
	case ButtonIconTiny:
		b.Size(24, 24)
		glyph = iconSmall
	default:
		b.Height(controlHeight).PaddingX(12)
		if p.Icon != nil {
			b.PaddingX(10)
		}
	}
	if iconOnly && p.Label != "" {
		b.Label(p.Label)
	}
	face, hover, pressed, fg := buttonPaint(t, p.Variant)
	switch {
	case p.Disabled:
		b.Disabled(true)
	case b.Pressed():
		face = pressed
	case b.Hovered():
		face = hover
	}
	if !p.Disabled && (b.Hovered() || b.Pressed()) {
		switch p.Variant {
		case ButtonGhost:
			fg = t.Text
		case ButtonLink:
			fg = t.AccentHover
		}
	}
	if p.Variant == ButtonSecondary {
		b.Border(1, t.Border)
	}
	b.Background(Face(c, b, "aui.button", face)).TextColor(fg)
	b.Children(func() {
		if p.Icon != nil {
			ic := ui.Icon(c, p.Icon).Size(glyph, glyph).Shrink(0)
			if p.IconColor.A > 0 {
				ic.TextColor(p.IconColor)
			}
		}
		if !iconOnly && p.Label != "" {
			ui.Text(c, p.Label).FontSize(labelSize).FontWeight(500).SingleLine()
		}
	})
	if p.OnClick != nil && !p.Disabled && b.Clicked() {
		p.OnClick()
	}
	return b
}

func buttonPaint(t *ui.Theme, v ButtonVariant) (face, hover, pressed, fg ui.Color) {
	switch v {
	case ButtonSecondary:
		return control(t), t.SurfaceHover, t.SurfacePressed, t.Text
	case ButtonGhost:
		return ui.Color{}, t.SurfaceHover, t.SurfacePressed, t.TextMuted
	case ButtonLink:
		return ui.Color{}, t.SurfaceHover, t.SurfacePressed, t.Accent
	case ButtonDanger:
		return t.Danger, t.Danger.Mix(t.Text, 0.1), t.Danger.Mix(t.Text, 0.2), ui.Hex("#ffffff")
	default:
		return t.Accent, t.AccentHover, t.AccentPressed, t.AccentText
	}
}
