// Package settings is the settings panel, dsh's ui-settings-general
// shell (packages/client/ui-settings-general): a modal of two columns, the
// Settings title over the navigation of the settings.section pages beside
// the chosen page, with Close and the header's Open configuration folder.
// It brings the General page — the settings.general.item rows, then the
// current version — and loads and saves the configuration files
// (settingsapi).
package settings

import (
	"context"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/plugins/cli"
	"github.com/cunninghamcard-bit/attention/native/settingsapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
)

// ID is the plugin's and its overlay's.
const ID = "settings"

// Settings is the panel's state, on the main thread only.
type Settings struct {
	open  bool
	shown string // the chosen page's ID
}

// Open opens the panel on page id ("" for General).
func (s *Settings) Open(id string) {
	s.open = true
	s.shown = id
}

// Toggle is app:open-settings: it opens the panel, or closes it.
func (s *Settings) Toggle() {
	if s.open {
		s.open = false
		return
	}
	s.Open("")
}

// View draws the panel while it is open: dsh's 800-wide panel, its height
// the window's less 24 above and below, at most 800.
func (s *Settings) View(c *ui.Context) {
	if !s.open {
		return
	}
	sections := slotsapi.SettingsSections()
	var cur *slotsapi.SettingsSection
	for i := range sections {
		if sections[i].ID == s.shown {
			cur = &sections[i]
		}
	}
	// A page gone with its plugin, or none chosen: the first.
	if cur == nil && len(sections) > 0 {
		cur = &sections[0]
	}
	_, winH := c.Size()
	h := min(float32(800), winH-48)
	omgui.Dialog(c, omgui.DialogProps{Open: &s.open, Key: ID, Width: 800, MaxHeight: h, Body: func(c *ui.Context) {
		// The modal keeps the window's shortcuts from it: the Settings
		// shortcut closes it from here.
		if c.Shortcut(ui.Cmd, ui.KeyComma) {
			s.open = false
			return
		}
		s.body(c, sections, cur, h-48)
	}})
}

func (s *Settings) body(c *ui.Context, sections []slotsapi.SettingsSection, cur *slotsapi.SettingsSection, h float32) {
	t := c.Theme()
	ui.Row(c).FillWidth().Height(h).AlignItems(ui.Stretch).Children(func() {
		// The 188-wide rail: the title, then a 40-high cell per page.
		ui.Column(c).Width(188).Shrink(0).FillHeight().Gap(4).Children(func() {
			ui.Text(c, "Settings").FontSize(16).FontWeight(500).Padding(2, 12, 12, 12)
			ui.Scroll(c).Grow(1).FillWidth().Children(func() {
				ui.Column(c).FillWidth().Gap(4).Children(func() {
					for _, sec := range sections {
						id := sec.ID
						if omgui.SidebarItem(c, omgui.SidebarItemProps{Key: "settings:" + id, Label: sec.Title, Icon: sec.Icon,
							Selected: cur != nil && id == cur.ID, Height: 40}).Clicked() {
							s.shown = id
						}
					}
				})
			})
		})
		ui.Column(c).Grow(1).MinWidth(0).FillHeight().Children(func() {
			// The header: the actions, left of the dialog's Close.
			ui.Row(c).FillWidth().Height(36).Shrink(0).Justify(ui.End).AlignItems(ui.Start).Padding(0, 40, 0, 0).Children(func() {
				omgui.Button(c, omgui.ButtonProps{Label: "Open configuration folder", Variant: omgui.ButtonGhost, OnClick: func() {
					dir := paths.ConfigDir()
					go func() { _ = mygo.Shell.OpenPath(dir) }()
				}})
			})
			ui.Scroll(c).Grow(1).Fill().Children(func() {
				ui.Column(c).FillWidth().Padding(0, 16, 16, 24).Gap(16).Children(func() {
					if cur == nil {
						ui.Text(c, "No settings").TextColor(t.TextMuted)
						return
					}
					cur.View(c)
				})
			})
		})
	})
}

// general is the General page: the rows plugins contribute, then the
// current version (dsh's GeneralSection and CurrentVersionRow).
func general(c *ui.Context) {
	omgui.SettingsSection(c, "", func() {
		for _, item := range slotsapi.GeneralItems() {
			item.View(c)
		}
		omgui.PreferenceRow(c, "Current version", "", func() {
			ui.Text(c, cli.Version).FontSize(13).TextColor(c.Theme().TextMuted)
		})
	})
}

// Register adds the panel, its General page, its command and its ribbon
// icon until off is called.
func Register() (s *Settings, off func()) {
	s = &Settings{}
	offs := []func(){
		slotsapi.RegisterOverlay(slotsapi.Overlay{ID: ID, Order: 10, View: s.View}),
		slotsapi.RegisterSettingsSection(slotsapi.SettingsSection{ID: "general", Title: "General", Icon: lucide.SlidersHorizontal(), Order: 0, View: general}),
		actionsapi.Register(actionsapi.Command{ID: "app:open-settings", Title: "Open settings", Keys: "Ctrl Comma", Main: s.Toggle,
			Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
				return shellapi.OnMain(ctx, func() (string, error) { s.Open(""); return "", nil })
			}}),
		slotsapi.RegisterRibbon(slotsapi.RibbonItem{ID: ID, Title: "Settings", Icon: lucide.Settings(), Order: 100, Run: func() { s.Open("") }}),
	}
	return s, func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

// Plugin is the settings panel while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		// The configuration it edits: read here, off the main thread.
		settingsapi.Load(settingsapi.App, settingsapi.Appearance, settingsapi.Hotkeys)
		_, off := Register()
		rctx.Effect(func(ctx context.Context) error {
			off()
			settingsapi.Flush(ctx)
			return nil
		})
		return nil
	},
})
