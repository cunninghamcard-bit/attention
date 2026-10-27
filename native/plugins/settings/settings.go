// Package settings is the settings modal, attention's SettingsModal and
// SettingsRenderer (apps/web/builtin/SettingsModal.ts, SettingsRenderer.ts):
// a vertical tab header — Search settings, then the Options tabs and the
// core plugins' tabs, the settings.section contributions — beside the
// chosen tab, whose name is the modal's title. It brings the General tab
// of its own, and loads and saves the configuration files (settingsapi).
package settings

import (
	"context"
	"strings"

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

// Plugin is the settings modal while loaded.
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

// Settings is the modal's state, on the main thread only.
type Settings struct {
	open  bool
	query string // Search settings
	shown string // the chosen tab's ID, kept while closed (lastTabId)
}

// Register adds the modal, its General tab, its command and its ribbon
// icon until off is called.
func Register() (s *Settings, off func()) {
	s = &Settings{shown: "general"}
	offs := []func(){
		slotsapi.RegisterOverlay(slotsapi.Overlay{ID: ID, Order: 10, View: s.View}),
		slotsapi.RegisterSettingsSection(slotsapi.SettingsSection{ID: "general", Title: "General", Icon: lucide.SlidersHorizontal(), Order: 0,
			Keywords: []string{"Current version", "Configuration folder"}, View: general}),
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

// Open opens the modal on tab id, or on the last tab for ""
// (SettingRegistry.open).
func (s *Settings) Open(id string) {
	s.open = true
	if id != "" {
		s.shown = id
	}
}

// Toggle is app:open-settings: it opens the modal, or closes it.
func (s *Settings) Toggle() {
	if s.open {
		s.open = false
		return
	}
	s.Open("")
}

// View draws the modal while it is open.
func (s *Settings) View(c *ui.Context) {
	if !s.open {
		return
	}
	var options, core []slotsapi.SettingsSection
	for _, sec := range slotsapi.SettingsSections() {
		if !matches(sec, s.query) {
			continue
		}
		if sec.Group == slotsapi.CorePlugins {
			core = append(core, sec)
		} else {
			options = append(options, sec)
		}
	}
	all := append(append([]slotsapi.SettingsSection(nil), options...), core...)
	var cur *slotsapi.SettingsSection
	for i := range all {
		if all[i].ID == s.shown {
			cur = &all[i]
		}
	}
	// A search that hides the shown tab, or a tab gone with its plugin:
	// the first that matches (findFirstMatchingTab).
	if cur == nil && len(all) > 0 {
		cur, s.shown = &all[0], all[0].ID
	}
	title := "Settings"
	if cur != nil {
		title = cur.Title
	}
	_, winH := c.Size()
	h := min(float32(680), winH-48)
	omgui.Dialog(c, omgui.DialogProps{Open: &s.open, Key: ID, Title: title, Width: 960, MaxHeight: h, Body: func(c *ui.Context) {
		// The modal keeps the window's shortcuts from it: the Settings
		// shortcut closes it from here.
		if c.Shortcut(ui.Cmd, ui.KeyComma) {
			s.open = false
			return
		}
		s.body(c, options, core, cur, h-80)
	}})
}

func (s *Settings) body(c *ui.Context, options, core []slotsapi.SettingsSection, cur *slotsapi.SettingsSection, h float32) {
	t := c.Theme()
	ui.Row(c).FillWidth().Height(h).AlignItems(ui.Stretch).Children(func() {
		// The vertical tab header.
		ui.Column(c).Width(210).Shrink(0).FillHeight().Gap(8).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Padding(0, 8, 0, 0).Children(func() {
			omgui.SearchField(c, &s.query, "Search settings", false).Label("Search settings").FillWidth()
			ui.Scroll(c).Grow(1).FillWidth().Children(func() {
				ui.Column(c).FillWidth().Gap(2).Children(func() {
					s.group(c, "Options", options)
					s.group(c, "Core plugins", core)
				})
			})
		})
		// The vertical tab content.
		ui.Scroll(c).Grow(1).Fill().Children(func() {
			ui.Column(c).FillWidth().Padding(4, 24, 24, 24).Gap(16).Children(func() {
				if cur == nil {
					ui.Text(c, "No settings match.").TextColor(t.TextMuted)
					return
				}
				cur.View(c)
			})
		})
	})
}

// group is a header group: its title, then a nav item per tab
// (createHeaderGroup); a group with no tab is left out.
func (s *Settings) group(c *ui.Context, title string, secs []slotsapi.SettingsSection) {
	if len(secs) == 0 {
		return
	}
	ui.Box(c).Padding(6, 8).Children(func() { omgui.SectionLabel(c, title) })
	for _, sec := range secs {
		id := sec.ID
		if omgui.SidebarItem(c, omgui.SidebarItemProps{Key: "settings:" + id, Label: sec.Title, Icon: sec.Icon, Selected: id == s.shown}).Clicked() {
			s.shown = id
		}
	}
}

// matches is SettingsRenderer.matchesTab: the query in the tab's name, its
// id or the names of its settings.
func matches(sec slotsapi.SettingsSection, query string) bool {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return true
	}
	for _, text := range append([]string{sec.Title, sec.ID}, sec.Keywords...) {
		if strings.Contains(strings.ToLower(text), q) {
			return true
		}
	}
	return false
}

// general is the General tab: the version and the configuration folder.
func general(c *ui.Context) {
	omgui.SettingsSection(c, "App", func() {
		omgui.PreferenceRow(c, "Current version", cli.Version, nil)
		omgui.PreferenceRow(c, "Configuration folder", paths.ConfigDir(), func() {
			omgui.Button(c, omgui.ButtonProps{Label: "Open", Variant: omgui.ButtonSecondary, OnClick: func() {
				dir := paths.ConfigDir()
				go func() { _ = mygo.Shell.OpenPath(dir) }()
			}})
		})
	})
}
