// Package settings is the settings tab (dsh's ui-settings-general shell;
// attention's settings, as a page tab rather than a modal: RFC §5.6): the
// page attention://settings, its sidebar of the settings.section
// contributions and the chosen one, with the General section of its own.
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
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// ID is the plugin's and its tab type's; Kind the page's.
const (
	ID   = "settings"
	Kind = "settings"
)

// Settings is the tab's state, on the main thread only: the section shown
// per tab.
type Settings struct {
	shown map[int]string
}

func (s *Settings) body(c *ui.Context, p tabtypesapi.Props) {
	t := c.Theme()
	sections := slotsapi.SettingsSections()
	shown := s.shown[p.Info.ID]
	var cur *slotsapi.SettingsSection
	items := make([]omgui.NavItem, 0, len(sections))
	for i := range sections {
		items = append(items, omgui.NavItem{ID: sections[i].ID, Label: sections[i].Title, Icon: sections[i].Icon})
		if sections[i].ID == shown {
			cur = &sections[i]
		}
	}
	if cur == nil && len(sections) > 0 {
		cur, shown = &sections[0], sections[0].ID
	}
	ui.Row(c).Grow(1).Fill().AlignItems(ui.Stretch).Children(func() {
		ui.Column(c).Width(180).Shrink(0).FillHeight().Background(t.Surface).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Children(func() {
			omgui.Sidebar(c, &shown, []omgui.NavSection{{Items: items}})
		})
		ui.Scroll(c).Grow(1).Fill().Children(func() {
			ui.Column(c).FillWidth().MaxWidth(760).Padding(24, 32).Gap(16).Children(func() {
				if cur == nil {
					ui.Text(c, "No settings").TextColor(t.TextMuted)
					return
				}
				ui.Text(c, cur.Title).FontSize(20).Bold()
				cur.View(c)
			})
		})
	})
	s.shown[p.Info.ID] = shown
}

// general is the General section: the version and the configuration
// folder.
func general(c *ui.Context) {
	omgui.SettingsSection(c, "About", func() {
		omgui.PreferenceRow(c, "Version", cli.Version, nil)
		omgui.PreferenceRow(c, "Configuration folder", paths.ConfigDir(), func() {
			omgui.Button(c, omgui.ButtonProps{Label: "Open", Variant: omgui.ButtonSecondary, OnClick: func() {
				dir := paths.ConfigDir()
				go func() { _ = mygo.Shell.OpenPath(dir) }()
			}})
		})
	})
}

// open is app:open-settings: the settings tab.
func open() {
	if ws := workspaceapi.Get(); ws != nil {
		_ = ws.OpenTab(Kind, workspaceapi.OpenOptions{})
	}
}

// Register adds the settings tab type, its General section, its command
// and its ribbon icon until off is called.
func Register() (off func()) {
	s := &Settings{shown: map[int]string{}}
	offs := []func(){
		tabtypesapi.Register(tabtypesapi.TabType{
			ID: ID, Kind: Kind, Priority: tabtypesapi.Builtin,
			Title:  func(string) string { return "Settings" },
			Icon:   lucide.Settings(),
			Body:   s.body,
			Closed: func(id int) { delete(s.shown, id) },
		}),
		slotsapi.RegisterSettingsSection(slotsapi.SettingsSection{ID: "general", Title: "General", Icon: lucide.SlidersHorizontal(), Order: 0, View: general}),
		actionsapi.Register(actionsapi.Command{ID: "app:open-settings", Title: "Open settings", Keys: "Ctrl Comma", Main: open,
			Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
				return shellapi.OnMain(ctx, func() (string, error) { open(); return "", nil })
			}}),
		slotsapi.RegisterRibbon(slotsapi.RibbonItem{ID: ID, Title: "Settings", Icon: lucide.Settings(), Order: 100, Run: open}),
	}
	return func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

// Plugin is the settings tab while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "actions", "workspace"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		off := Register()
		rctx.Effect(func(context.Context) error { off(); return nil })
		return nil
	},
})
