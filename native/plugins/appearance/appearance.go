// Package appearance is the appearance plugin: appearance.json, the color
// themes, and the widget themes built from them (docs/appearance.md,
// apps/web/core/AppearanceManager.ts, apps/web/builtin/AppearanceSettingTab.ts).
package appearance

import (
	"context"
	"path/filepath"
	"slices"

	"github.com/arcships/rutis/go/rutis"
	acard "github.com/cunninghamcard-bit/acard-ui/tokens"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/terminal"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"

	"github.com/cunninghamcard-bit/attention/native/internal/fileicon"
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// ID is the plugin's name.
const ID = "appearance"

// Plugin provides the "appearance" service while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "slots", "settings", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh  *shell.Shell
			sl  *slots.Registry
			set *settings.Settings
			act *actions.Service
		)
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		if err := rctx.Use("slots", &sl); err != nil {
			return err
		}
		if err := rctx.Use("settings", &set); err != nil {
			return err
		}
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		a := New(set, filepath.Join(paths.ConfigDir(), "themes"), sh.Update)
		off := a.Register(sh, sl, act)
		rctx.Provide("appearance", a)
		rctx.Effect(func(context.Context) error {
			off()
			return nil
		})
		return nil
	},
})

// Appearance is the "appearance" service, on the main thread only: it
// rebuilds the widget themes when appearance.json or the theme files change.
type Appearance struct {
	set     *settings.Settings
	dir     string
	post    func(func())
	cat     catalog
	gen     int
	catGen  int
	builtAt [2]int
	cur     Settings
	built   [2]built
	tab     tab

	IsDark func() bool
}

// New loads the theme files of dir; post runs a function on the main thread.
func New(set *settings.Settings, dir string, post func(func())) *Appearance {
	return &Appearance{set: set, dir: dir, post: post, cat: loadCatalog(dir), gen: -1, catGen: 1, IsDark: mygo.Theme.IsDark}
}

// Register adds the Appearance settings tab and the theme commands until off is called.
func (a *Appearance) Register(sh *shell.Shell, sl *slots.Registry, act *actions.Service) (off func()) {
	offs := []func(){
		sl.RegisterSettingsSection(slots.SettingsSection{
			ID: ID, Title: "Appearance", Icon: icon.Must("palette"), Order: 20,
			Keywords: a.keywords(), View: a.View,
		}),
	}
	cmd := func(id, title string, fn func()) actions.Command {
		return actions.Command{ID: id, Title: title, Main: fn, Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, sh, func() (string, error) { fn(); return "", nil })
		}}
	}
	for _, c := range []actions.Command{
		cmd("appearance:toggle-theme", "Toggle light/dark theme", a.ToggleTheme),
		cmd("theme:selector", "Switch color theme", a.CycleTheme),
	} {
		offs = append(offs, act.Add(c))
	}
	return func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

// Settings are appearance.json's current values, the defaults for a nil a.
func (a *Appearance) Settings() Settings {
	if a == nil {
		return DefaultSettings()
	}
	a.refresh()
	return a.cur
}

// Generation moves whenever a theme getter may return something new.
func (a *Appearance) Generation() int {
	a.refresh()
	return a.gen + a.catGen
}

// Dark reports whether the window is dark: the base scheme, or the system's.
func (a *Appearance) Dark() bool {
	switch a.Settings().Theme {
	case "light":
		return false
	case "dark":
		return true
	}
	return a.IsDark()
}

// UI is the window's theme, for the root's SetTheme.
func (a *Appearance) UI() *ui.Theme { return a.of(a.Dark()).ui }

// Editor is the code editor's theme for a window of dark.
func (a *Appearance) Editor(dark bool) *editor.Theme { return a.of(dark).editor }

// Markdown is the reading view's theme for a window of dark.
func (a *Appearance) Markdown(dark bool) *markdown.Theme { return a.of(dark).markdown }

// Terminal is the terminal's theme for a window of dark.
func (a *Appearance) Terminal(dark bool) *terminal.Theme { return a.of(dark).terminal }

// Icons is how files get icons.
func (a *Appearance) Icons() fileicon.Theme {
	s := a.Settings()
	return fileicon.Theme{Show: s.ShowFileIcons, Name: s.IconTheme}
}

// ThemeNames are the light or dark themes there are.
func (a *Appearance) ThemeNames(dark bool) []string { return a.cat.names(dark) }

// Reload reads the theme files again, off the main thread.
func (a *Appearance) Reload() {
	dir := a.dir
	go func() {
		cat := loadCatalog(dir)
		a.post(func() {
			a.cat = cat
			a.catGen++
		})
	}()
}

// ToggleTheme switches between light and dark.
func (a *Appearance) ToggleTheme() {
	if a.Dark() {
		a.set.Set(settings.Appearance, "theme", "light")
	} else {
		a.set.Set(settings.Appearance, "theme", "dark")
	}
}

// CycleTheme moves the active light or dark theme to the next one.
func (a *Appearance) CycleTheme() {
	dark := a.Dark()
	names := a.cat.names(dark)
	if len(names) == 0 {
		return
	}
	key, cur := "lightTheme", a.cur.LightTheme
	if dark {
		key, cur = "darkTheme", a.cur.DarkTheme
	}
	next := names[0]
	if i := slices.Index(names, cur); i >= 0 {
		next = names[(i+1)%len(names)]
	}
	a.set.Set(settings.Appearance, key, next)
}

func (a *Appearance) refresh() {
	g := 0
	if a.set != nil {
		g = a.set.Generation()
	}
	if g != a.gen {
		a.gen = g
		a.cur = load(a.set)
	}
}

func (a *Appearance) of(dark bool) built {
	a.refresh()
	i, name := 0, a.cur.LightTheme
	if dark {
		i, name = 1, a.cur.DarkTheme
	}
	if at := a.gen + a.catGen; a.built[i].ui == nil || a.builtAt[i] != at {
		t := a.cat.theme(name, dark)
		var sch *Scheme
		if s, ok := a.cat.scheme(a.cur.EditorTheme, t); ok {
			sch = &s
		}
		if old := a.built[i].ui; old != nil {
			aui.Unregister(old)
			acard.Unregister(old)
		}
		a.built[i] = build(t, sch, a.cur)
		aui.Register(a.built[i].ui, a.built[i].tokens)
		acard.Register(a.built[i].ui, a.built[i].acard)
		a.builtAt[i] = at
	}
	return a.built[i]
}
