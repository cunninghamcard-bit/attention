// Package workspace is the workspace UI plugin: the window's center (the
// layout plugin draws the rest) — tab groups in splits (tree.go), their
// tabs, whose bodies are the tab types' (tabtypes), the view and tab
// headers, the session of open tabs — and the CLI's open, tabs, recents,
// tab:open and workspace.
//
// TODO(RFC §5.6–§5.7): opening goes through navigation.
package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/arcships/rutis/go/rutis"
	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/appearance"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/layout"
	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/resources"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/shortcuts"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
)

const (
	// TabsPanelID is the sidebar panel listing the tabs.
	TabsPanelID = "tabs"

	// tabsSourceID is the palette source of the open tabs; omniboxID and
	// omniboxNewID are the omnibox plugin's, in the active tab and in a
	// new one.
	tabsSourceID = "tabs"
	omniboxID    = "omnibox"
	omniboxNewID = "omnibox-new"
)

// Plugin is the center while loaded and provides "tabTypes" and "workspace".
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "workspace",
	Inject: []string{"shell", "slots", "resources", "layout", "shortcuts", "fs", "project", "actions", "appearance"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh      *shell.Shell
			sl      *slots.Registry
			res     *resources.Registry
			lyt     *layout.Layout
			sc      *shortcuts.Shortcuts
			fs      fsplugin.FS
			project projectplugin.Project
			act     *actions.Service
			app     *appearance.Appearance
		)
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		if err := rctx.Use("slots", &sl); err != nil {
			return err
		}
		if err := rctx.Use("resources", &res); err != nil {
			return err
		}
		if err := rctx.Use("layout", &lyt); err != nil {
			return err
		}
		if err := rctx.Use("shortcuts", &sc); err != nil {
			return err
		}
		if err := rctx.Use("fs", &fs); err != nil {
			return err
		}
		if err := rctx.Use("project", &project); err != nil {
			return err
		}
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		if err := rctx.Use("appearance", &app); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		ws := newWorkspace(ctx, sh, sl, res, lyt, sc, act, app, fs, project)
		rctx.Provide("tabTypes", ws.tabTypes)
		rctx.Provide("workspace", ws)
		saver := persist.New(sh, paths.SessionPath(), func() any { return ws.snapshot() })
		ws.saveSoon = saver.Soon

		// Restore the tree, then the mounts (which reopen the tabs).
		saved, ok := loadSession()
		sh.Update(func() {
			if ok {
				ws.restoreLayout(saved)
			}
		})
		reloadMounts := func() {
			go func() {
				ms, err := project.Mounts(ctx)
				if err != nil {
					return
				}
				sh.Update(func() { ws.setMounts(ms) })
			}()
		}
		reloadMounts()
		rctx.On(projectplugin.MountsChangedEvent, func(context.Context, ...any) (any, error) {
			reloadMounts()
			return nil, nil
		})

		off := Register(ws)
		rctx.Effect(func(effectCtx context.Context) error {
			if os.Getenv("ATTENTION_DEBUG") != "" {
				fmt.Fprintln(os.Stderr, "[debug] workspace: cleanup start")
				defer fmt.Fprintln(os.Stderr, "[debug] workspace: cleanup end")
			}
			off()
			// The final save; the run loop runs until every plugin has
			// unloaded.
			saver.Final(effectCtx)
			cancel()
			return nil
		})
		return nil
	},
})

// Nav is where to put the caret or what to select after opening a file.
type Nav = tabtypes.Nav

// OpenOptions are OpenResource's and OpenTab's options.
type OpenOptions struct {
	Nav    *Nav
	NewTab bool
	// Kind is the tab kind to open as ("text", "markdown", ...), "" for
	// the highest-priority claim.
	Kind string
	// KeepActive opens it in a new tab rather than in the active one,
	// unless that is an empty new tab; a tab showing it is still revealed.
	KeepActive bool
}

// Open shows path in the workspace (reusing an open tab for it, or in the
// active tab; in a new tab when newTab is true) and applies nav when given.
func (ws *Workspace) Open(path string, nav *Nav, newTab bool) {
	ws.openIn(path, nav, newTab)
}

// OpenBeside shows path as Open does, but in a new tab rather than in the
// active one, as a click in the file tree does.
func (ws *Workspace) OpenBeside(path string) {
	ws.openAddress(ws.addressOf(path), path, OpenOptions{KeepActive: true})
}

// OpenTab shows the page of kind (an address-less tab type such as
// terminal): its open tab, or a new one.
func (ws *Workspace) OpenTab(kind string, o OpenOptions) error {
	_, err := ws.openTab(kind, o)
	return err
}

// OpenResource shows address in the workspace (as Open does for a path).
func (ws *Workspace) OpenResource(address string, o OpenOptions) error {
	_, err := ws.openResource(address, o)
	return err
}

// OpenSplit shows address beside the focused card (RFC 0006 §7.3): the
// tab that shows it already, else a new tab in the card to the right,
// splitting the focused card when none is there.
func (ws *Workspace) OpenSplit(address string, o OpenOptions) error {
	if ws.showing(address, o.Kind) {
		return ws.OpenResource(address, o)
	}
	if g := ws.adjacent(ws.activePane(), "right"); g != nil {
		ws.activeGroup = g
	} else if len(ws.groups()) < maxCards {
		ws.activeGroup = ws.splitGroup(ws.activePane(), vertical, false)
	}
	o.NewTab = true
	_, err := ws.openResource(address, o)
	ws.changed()
	return err
}

// ActivePath is the active tab's file path, or "" when no file is active.
func (ws *Workspace) ActivePath() string {
	if t := ws.activeTab(); t != nil && !t.empty {
		return t.path
	}
	return ""
}

// ActiveTab is the active tab, or ok false when none is active or the
// active tab is an empty new tab.
func (ws *Workspace) ActiveTab() (tabtypes.Info, bool) {
	if t := ws.activeTab(); t != nil && !t.empty {
		return ws.props(t, true).Info, true
	}
	return tabtypes.Info{}, false
}

// Project is the project (mount) holding path, false outside every one.
func (ws *Workspace) Project(path string) (projectplugin.Mount, bool) {
	m, _, ok := ws.mountOf(path)
	return m, ok
}

// Display is path as the workspace shows it: "<mount>/<rel>" under a mount,
// else path.
func (ws *Workspace) Display(path string) string { return ws.display(path) }

// ResolveLink resolves a Markdown link or [[wikilink]] target from a file
// in dir against the mounts, off the main thread.
func (ws *Workspace) ResolveLink(ctx context.Context, link, dir string) (string, error) {
	mounts, err := ws.project.Mounts(ctx)
	if err != nil {
		return "", err
	}
	return projectplugin.ResolveLink(ctx, ws.project.Files, mounts, link, dir)
}

// RecentFiles are the files opened last, newest first.
func (ws *Workspace) RecentFiles() []string { return append([]string(nil), ws.recentFiles...) }

// commands are the workspace's palette and CLI commands. Main runs them
// on the main thread (a shortcut, the palette); Run off it (the CLI, on
// its connection's goroutine), hopping to the main thread with
// shell.OnMain.
func (ws *Workspace) commands() []actions.Command {
	ui := func(id, title, keys string, fn func()) actions.Command {
		run := func() { ws.flush(); fn() }
		return actions.Command{ID: id, Title: title, Keys: keys, Main: run, Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, ws.sh, func() (string, error) { run(); return "", nil })
		}}
	}
	gotos := make([]actions.Command, 0, 8)
	for n := 1; n <= 8; n++ {
		gotos = append(gotos, ui(fmt.Sprintf("workspace:goto-tab-%d", n), fmt.Sprintf("Go to tab %d", n), fmt.Sprintf("Ctrl %d", n), func() { ws.gotoTab(n) }))
	}
	return append(gotos, []actions.Command{
		// IDs, names and keys are attention's (apps/web/app/AppCommands.ts,
		// CommandPalette.ts, QuickSwitcher.ts, CorePlugins.ts) where it has
		// the command; the rest are the reader's own.
		ui("workspace:close", "Close current tab", "Ctrl W", ws.closeActiveTab),
		ui("workspace:new-tab", "Open new tab", "", ws.newTab),
		ui("workspace:undo-close-pane", "Undo close tab", "Ctrl Shift T", ws.undoClose),
		ui("workspace:next-tab", "Go to next tab", "Control Tab, Ctrl Shift ], Control PageDown", func() { ws.cycleTab(1) }),
		ui("workspace:previous-tab", "Go to previous tab", "Control Shift Tab, Ctrl Shift [, Control PageUp", func() { ws.cycleTab(-1) }),
		ui("workspace:goto-last-tab", "Go to last tab", "Ctrl 9", func() { ws.gotoTab(0) }),
		ui("workspace:go-back", "Navigate back", "Alt Left", func() { ws.goHistory(ws.activeTab(), -1) }),
		ui("workspace:go-forward", "Navigate forward", "Alt Right", func() { ws.goHistory(ws.activeTab(), 1) }),
		ui("workspace:copy-path", "Copy path", "", func() { ws.copyPath(false) }),
		ui("workspace:copy-full-path", "Copy absolute path", "", func() { ws.copyPath(true) }),
		ui("open-with-default-app:open", "Open in default app", "", func() { ws.withActiveFile(mygo.Shell.OpenPath) }),
		ui("open-with-default-app:show", "Show in system explorer", "", func() {
			ws.withActiveFile(func(path string) error { mygo.Shell.ShowItemInFolder(path); return nil })
		}),
		ui("workspace:toggle-pin", "Pin or unpin current tab", "", ws.TogglePin),
		ui("workspace:new-folder", "New pinned folder", "", func() { ws.newFolder() }),
		ui("workspace:organize-by-project", "Organize tabs by project", "", ws.organizeByProject),
		ui("workspace:split-vertical", "Split right", "Ctrl \\", func() { ws.split(vertical) }),
		ui("workspace:split-horizontal", "Split down", "", func() { ws.split(horizontal) }),
		ui("editor:focus-top", "Navigate tab above", "", func() { ws.focusDirection("top") }),
		ui("editor:focus-bottom", "Navigate tab below", "", func() { ws.focusDirection("bottom") }),
		ui("editor:focus-left", "Navigate tab left", "", func() { ws.focusDirection("left") }),
		ui("editor:focus-right", "Navigate tab right", "", func() { ws.focusDirection("right") }),
		ui("workspace:close-others", "Close other tabs", "", ws.closeOthers),
		ui("workspace:close-tab-group", "Close tab group", "", ws.closeTabGroup),
		ui("workspace:close-others-tab-group", "Close others in tab group", "", ws.closeOthersInGroup),
		{ID: "workspace:add-folder", Title: "Add folder to workspace", Run: func(ctx context.Context, _ actions.Args) (string, error) {
			dirs, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: ws.sh.Window(), Title: "Add Folder to Project", Directory: true})
			if err != nil || len(dirs) == 0 {
				return "", err
			}
			_, err = ws.project.AddMount(ctx, dirs[0])
			return "", err
		}},
		{ID: "focus", CLI: true, Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, ws.sh, func() (string, error) {
				if w := ws.sh.Window(); w != nil {
					w.Show()
					w.Focus()
				}
				return "", nil
			})
		}},
		{ID: "open", CLI: true, Run: ws.cliOpen},
		{ID: "tabs", CLI: true, Run: func(ctx context.Context, a actions.Args) (string, error) {
			return shell.OnMain(ctx, ws.sh, func() (string, error) {
				// The TS CLI's shape: "[<view type>] <display text>", then a tab
				// ID with ids.
				var lines []string
				for _, p := range ws.allGroups() {
					for _, t := range p.tabs {
						line := "[" + t.viewType() + "] " + t.displayText()
						if a.Has("ids") {
							line += "\t" + strconv.Itoa(t.id)
						}
						lines = append(lines, line)
					}
				}
				return strings.Join(lines, "\n"), nil
			})
		}},
		{ID: "recents", CLI: true, Run: ws.cliRecents},
		{ID: "tab:open", CLI: true, Run: ws.cliTabOpen},
		{ID: "workspace", CLI: true, Run: ws.cliWorkspace},
	}...)
}

// cliOpen is `open path=<path> | file=<name> [line=<n> [to=<n>]] [kind=<kind>] [newtab]`,
// with the TS CLI's messages. path= is exact: "<mount>/<rel>", absolute, or
// relative to the caller's directory or a mount. file= resolves like a
// wikilink: the extension may be left off (.md) and a bare name is found
// anywhere in the mounts. The disk is read here, off the main thread.
func (ws *Workspace) cliOpen(ctx context.Context, a actions.Args) (string, error) {
	path, byFile := a.Params["path"], false
	if path == "" {
		path, byFile = a.Params["file"], true
	}
	if path == "" {
		return "", fmt.Errorf("Missing required parameter: file or path")
	}
	line, hasLine, err := a.Int("line")
	if err != nil {
		return "", err
	}
	to, hasTo, err := a.Int("to")
	if err != nil {
		return "", err
	}
	if hasTo && !hasLine {
		return "", fmt.Errorf("to= needs line=")
	}
	if hasTo && to < line {
		return "", fmt.Errorf("Invalid to: %d", to)
	}
	mounts, err := ws.project.Mounts(ctx)
	if err != nil {
		return "", err
	}
	target := path
	if byFile {
		target, err = projectplugin.ResolveLink(ctx, ws.project.Files, mounts, path, a.Cwd)
	} else {
		target, err = projectplugin.ResolvePath(mounts, path, a.Cwd)
	}
	if err != nil {
		return "", err
	}
	return shell.OnMain(ctx, ws.sh, func() (string, error) {
		var nav *Nav
		if hasLine {
			nav = &Nav{Line: line, To: to}
		}
		opts := OpenOptions{Nav: nav, NewTab: a.Has("newtab"), Kind: a.Params["kind"]}
		if _, err := ws.openAddress(ws.addressOf(target), target, opts); err != nil {
			return "", err
		}
		if w := ws.sh.Window(); w != nil {
			w.Focus()
		}
		out := "Opened: " + ws.display(target)
		switch {
		case hasTo && to != line:
			out += fmt.Sprintf(":%d-%d", line, to)
		case hasLine:
			out += fmt.Sprintf(":%d", line)
		}
		return out, nil
	})
}

// copyPath copies the active tab's path: as the CLI shows it, or absolute.
func (ws *Workspace) copyPath(absolute bool) {
	if t := ws.activeTab(); t != nil && !t.empty && !t.page() {
		if absolute {
			mygo.Clipboard.WriteText(t.path)
		} else {
			mygo.Clipboard.WriteText(ws.display(t.path))
		}
	}
}

// withActiveFile runs fn on the active tab's path off the main thread.
func (ws *Workspace) withActiveFile(fn func(path string) error) {
	if t := ws.activeTab(); t != nil && !t.empty && !t.page() {
		path := t.path
		go func() { _ = fn(path) }()
	}
}

// viewType names a tab's view as the TS CLI's tabs does: its kind.
func (t *tab) viewType() string {
	switch {
	case t.empty:
		return "empty"
	case t.kind == "":
		return "none"
	}
	return t.kind
}

// displayText is a tab's name as the TS CLI shows it: a note without its
// extension, any other file by its base name.
func (t *tab) displayText() string {
	if t.kind == "markdown" {
		return strings.TrimSuffix(t.title, filepath.Ext(t.title))
	}
	return t.title
}

// Register makes ws the center (the workspace.center slot), with the
// sidebar's head, status line and list of tabs, its actions hooks
// and its commands, until off is called.
func Register(ws *Workspace) (off func()) {
	offs := []func(){
		ws.sl.SetCenter(ws.view),
		ws.sl.SetChrome(slots.Chrome{Nav: ws.headNav, Bar: ws.addressBar, Status: ws.tabStatus, Tint: ws.tint}),
		ws.sl.RegisterPanel(slots.Panel{ID: TabsPanelID, Title: "Tabs", Icon: icon.Files.SVG(), Dock: slots.Sidebar,
			Order: -10, View: ws.tabsPanel}),
		ws.sl.RegisterPaletteSource(ws.tabsSource()),
		ws.act.SetActiveFile(func(ctx context.Context) (string, error) {
			if ws.sh.Window() == nil {
				return "", nil
			}
			return shell.OnMain(ctx, ws.sh, func() (string, error) {
				return ws.ActivePath(), nil
			})
		}),
		ws.act.SetOpenPath(func(ctx context.Context, path string, newTab bool) error {
			_, err := shell.OnMain(ctx, ws.sh, func() (string, error) {
				if err := ws.OpenResource(ws.addressOf(path), OpenOptions{NewTab: newTab}); err != nil {
					return "", err
				}
				if w := ws.sh.Window(); w != nil {
					w.Focus()
				}
				return "", nil
			})
			return err
		}),
	}
	for _, cmd := range ws.commands() {
		offs = append(offs, ws.act.Add(cmd))
	}
	return func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

func openExternal(url string) {
	go func() { _ = mygo.Shell.OpenExternal(url) }()
}
