// Package settings is the settings modal, attention's SettingsModal and
// SettingsRenderer (apps/web/builtin/SettingsModal.ts, SettingsRenderer.ts):
// a vertical tab header — Search settings, then the Options tabs and the
// core plugins' tabs, the settings.section contributions — beside the
// chosen tab, titled by it. It brings the General tab of its own, and
// loads and saves the configuration files (settingsapi).
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

// Settings is the modal's state, on the main thread only.
type Settings struct {
	open  bool
	query string // Search settings
	shown string // the chosen tab's ID
}

// Open opens the modal on tab id, or on the last tab for "".
func (s *Settings) Open(id string) {
	s.open = true
	if id != "" {
		s.shown = id
	}
}

// Toggle opens the modal, or closes it when open (the same shortcut).
func (s *Settings) Toggle() {
	if s.open {
		s.open = false
		return
	}
	s.Open("")
}

// matches is SettingsRenderer.matchesTab: every word of the query in the
// tab's name or the names of its settings.
func matches(sec slotsapi.SettingsSection, query string) bool {
	words := strings.Fields(strings.ToLower(query))
	hay := strings.ToLower(sec.Title + " " + strings.Join(sec.Keywords, " "))
	for _, w := range words {
		if !strings.Contains(hay, w) {
			return false
		}
	}
	return true
}

// View draws the modal while it is open.
func (s *Settings) View(c *ui.Context) {
	if !s.open {
		return
	}
	var options, core []slotsapi.SettingsSection
	var cur *slotsapi.SettingsSection
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
	for i := range all {
		if all[i].ID == s.shown {
			cur = &all[i]
		}
	}
	// A search that hides the shown tab shows the first that matches.
	if cur == nil && len(all) > 0 {
		cur, s.shown = &all[0], all[0].ID
	}
	title := "Settings"
	if cur != nil {
		title = cur.Title
	}
	omgui.Dialog(c, omgui.DialogProps{Open: &s.open, Key: ID, Title: title, Width: 960, MaxHeight: 680, Body: func(c *ui.Context) {
		s.body(c, options, core, cur)
	}})
}

func (s *Settings) body(c *ui.Context, options, core []slotsapi.SettingsSection, cur *slotsapi.SettingsSection) {
	t := c.Theme()
	ui.Row(c).FillWidth().Height(600).AlignItems(ui.Stretch).Children(func() {
		ui.Column(c).Width(210).Shrink(0).FillHeight().Gap(8).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Padding(0, 8, 0, 0).Children(func() {
			omgui.Field(c, &s.query, "Search settings", false).FillWidth()
			ui.Scroll(c).Grow(1).FillWidth().Children(func() {
				ui.Column(c).FillWidth().Gap(2).Children(func() {
					s.group(c, "Options", options)
					s.group(c, "Core plugins", core)
				})
			})
		})
		ui.Scroll(c).Grow(1).Fill().Children(func() {
			ui.Column(c).FillWidth().Padding(4, 24).Gap(16).Children(func() {
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

// Register adds the modal, its General tab, its command and its ribbon
// icon until off is called.
func Register() (s *Settings, off func()) {
	s = &Settings{shown: "general"}
	offs := []func(){
		slotsapi.RegisterOverlay(slotsapi.Overlay{ID: ID, Order: 10, View: s.View}),
		slotsapi.RegisterSettingsSection(slotsapi.SettingsSection{ID: "general", Title: "General", Icon: lucide.SlidersHorizontal(), Order: 0,
			Keywords: []string{"version", "configuration folder"}, View: general}),
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
