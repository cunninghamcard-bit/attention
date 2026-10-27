// Package workspace is the workspace UI plugin: the window's center (the
// layout plugin draws the rest) — tab groups in splits (tree.go), their
// tabs, whose bodies are the tab types' (tabtypesapi), the view and tab
// headers, the session of open tabs — and the CLI's open and tabs.
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
	"github.com/egoist/mygo"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

func openExternal(url string) {
	go func() { _ = mygo.Shell.OpenExternal(url) }()
}

// Register makes ws the center (the workspace.center slot), with its
// status bar items, its API and its commands, until off is called.
func Register(ws *Workspace) (off func()) {
	offs := []func(){
		slotsapi.SetCenter(ws.view),
		slotsapi.RegisterStatus(slotsapi.StatusItem{ID: "workspace-mounts", View: ws.mountsStatus}),
		slotsapi.RegisterStatus(slotsapi.StatusItem{ID: "workspace-tab", Right: true, View: ws.tabStatus}),
		workspaceapi.Set(api{ws}),
	}
	for _, cmd := range ws.commands() {
		offs = append(offs, actionsapi.Register(cmd))
	}
	return func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

// Plugin is the center while loaded and provides "workspace", which panel
// plugins inject to be ordered after it (they reach the workspace through
// workspaceapi).
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "workspace",
	Inject: []string{"shell", "fs", "project", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var fs fscontract.FS
		var project projectcontract.Project
		if err := rctx.Use("fs", &fs); err != nil {
			return err
		}
		if err := rctx.Use("project", &project); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		ws := newWorkspace(ctx, fs, project)
		saver := persist.New(paths.SessionPath(), func() any { return ws.snapshot() })
		ws.saveSoon = saver.Soon

		// Restore the tree, then the mounts (which reopen the tabs).
		saved, ok := loadSession()
		shellapi.Update(func() {
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
				shellapi.Update(func() { ws.setMounts(ms) })
			}()
		}
		reloadMounts()
		rctx.On(projectcontract.MountsChangedEvent, func(context.Context, ...any) (any, error) {
			reloadMounts()
			return nil, nil
		})

		rctx.Provide("workspace", struct{}{})
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

// commands are the workspace's palette and CLI commands. Main runs them
// on the main thread (a shortcut, the palette); Run off it (the CLI, on
// its connection's goroutine), hopping to the main thread with
// shellapi.OnMain.
func (ws *Workspace) commands() []actionsapi.Command {
	ui := func(id, title, keys string, fn func()) actionsapi.Command {
		return actionsapi.Command{ID: id, Title: title, Keys: keys, Main: fn, Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			return shellapi.OnMain(ctx, func() (string, error) { fn(); return "", nil })
		}}
	}
	gotos := make([]actionsapi.Command, 0, 8)
	for n := 1; n <= 8; n++ {
		gotos = append(gotos, ui(fmt.Sprintf("workspace:goto-tab-%d", n), fmt.Sprintf("Go to tab %d", n), fmt.Sprintf("Ctrl %d", n), func() { ws.gotoTab(n) }))
	}
	return append(gotos, []actionsapi.Command{
		// IDs, names and keys are attention's (apps/web/app/AppCommands.ts,
		// CommandPalette.ts, QuickSwitcher.ts, CorePlugins.ts) where it has
		// the command; the rest are the reader's own.
		ui("workspace:close", "Close current tab", "Ctrl W", ws.closeActiveTab),
		ui("workspace:new-tab", "Open new tab", "Ctrl T", ws.newTab),
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
		ui("workspace:split-vertical", "Split right", "Ctrl \\", func() { ws.split(vertical) }),
		ui("workspace:split-horizontal", "Split down", "", func() { ws.split(horizontal) }),
		ui("editor:focus-top", "Navigate tab above", "", func() { ws.focusDirection("top") }),
		ui("editor:focus-bottom", "Navigate tab below", "", func() { ws.focusDirection("bottom") }),
		ui("editor:focus-left", "Navigate tab left", "", func() { ws.focusDirection("left") }),
		ui("editor:focus-right", "Navigate tab right", "", func() { ws.focusDirection("right") }),
		ui("workspace:close-others", "Close other tabs", "", ws.closeOthers),
		ui("workspace:close-tab-group", "Close tab group", "", ws.closeTabGroup),
		ui("workspace:close-others-tab-group", "Close others in tab group", "", ws.closeOthersInGroup),
		{ID: "workspace:add-folder", Title: "Add folder to workspace", Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			dirs, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: shellapi.Window(), Title: "Add Folder to Project", Directory: true})
			if err != nil || len(dirs) == 0 {
				return "", err
			}
			_, err = ws.project.AddMount(ctx, dirs[0])
			return "", err
		}},
		{ID: "focus", CLI: true, Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			return shellapi.OnMain(ctx, func() (string, error) {
				if w := shellapi.Window(); w != nil {
					w.Show()
					w.Focus()
				}
				return "", nil
			})
		}},
		{ID: "open", CLI: true, Run: ws.cliOpen},
		{ID: "tabs", CLI: true, Run: func(ctx context.Context, a actionsapi.Args) (string, error) {
			return shellapi.OnMain(ctx, func() (string, error) {
				// The TS CLI's shape: "[<view type>] <display text>", then a tab
				// ID with ids.
				var lines []string
				for _, p := range ws.groups() {
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
	}...)
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

// cliOpen is `open path=<path> | file=<name> [line=<n> [to=<n>]] [kind=<kind>] [newtab]`,
// with the TS CLI's messages. path= is exact: "<mount>/<rel>", absolute, or
// relative to the caller's directory or a mount. file= resolves like a
// wikilink: the extension may be left off (.md) and a bare name is found
// anywhere in the mounts. The disk is read here, off the main thread.
func (ws *Workspace) cliOpen(ctx context.Context, a actionsapi.Args) (string, error) {
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
		target, err = ws.resolveLink(ctx, mounts, path, a.Cwd)
	} else {
		target, err = resolvePath(mounts, path, a.Cwd)
	}
	if err != nil {
		return "", err
	}
	return shellapi.OnMain(ctx, func() (string, error) {
		var nav *workspaceapi.Nav
		if hasLine {
			nav = &workspaceapi.Nav{Line: line, To: to}
		}
		opts := workspaceapi.OpenOptions{Nav: nav, NewTab: a.Has("newtab"), Kind: a.Params["kind"]}
		if _, err := ws.openAddress(ws.addressOf(target), target, opts); err != nil {
			return "", err
		}
		if w := shellapi.Window(); w != nil {
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

// candidates are the places a CLI path may name: absolute, "<mount>/<rel>",
// relative to the caller's directory, relative to each mount.
func candidates(mounts []projectcontract.Mount, target, cwd string) []string {
	if filepath.IsAbs(target) {
		return []string{filepath.Clean(target)}
	}
	var out []string
	if name, rel, ok := strings.Cut(target, "/"); ok {
		for _, m := range mounts {
			if m.Name == name {
				out = append(out, filepath.Join(m.Path, filepath.FromSlash(rel)))
			}
		}
	}
	if cwd != "" {
		out = append(out, filepath.Join(cwd, target))
	}
	for _, m := range mounts {
		out = append(out, filepath.Join(m.Path, filepath.FromSlash(target)))
	}
	return out
}

// resolvePath is path=: exact, as the TS CLI's.
func resolvePath(mounts []projectcontract.Mount, target, cwd string) (string, error) {
	for _, p := range candidates(mounts, target, cwd) {
		st, err := os.Stat(p)
		if err != nil {
			continue
		}
		if st.IsDir() {
			return "", fmt.Errorf("%q is a folder, not a file.", target)
		}
		return p, nil
	}
	return "", fmt.Errorf("File %q not found.", target)
}

// resolveLink is file=: a path with or without ".md" first, then the first
// file anywhere in the mounts whose path ends with it, without case.
func (ws *Workspace) resolveLink(ctx context.Context, mounts []projectcontract.Mount, link, cwd string) (string, error) {
	tries := []string{link}
	if filepath.Ext(link) == "" {
		tries = append(tries, link+".md")
	}
	for _, t := range tries {
		for _, p := range candidates(mounts, t, cwd) {
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p, nil
			}
		}
	}
	listing, err := ws.project.Files(ctx)
	if err != nil {
		return "", err
	}
	for _, t := range tries {
		want := "/" + strings.ToLower(filepath.ToSlash(t))
		for _, f := range listing.Files {
			if strings.HasSuffix("/"+strings.ToLower(f.Rel), want) {
				return f.Path, nil
			}
		}
	}
	return "", fmt.Errorf("File %q not found.", link)
}

// api is the workspace as workspaceapi.API.
type api struct{ ws *Workspace }

func (a api) Open(path string, nav *workspaceapi.Nav, newTab bool) { a.ws.openIn(path, nav, newTab) }

func (a api) OpenTab(kind string, o workspaceapi.OpenOptions) error {
	_, err := a.ws.openTab(kind, o)
	return err
}

func (a api) OpenResource(address string, o workspaceapi.OpenOptions) error {
	_, err := a.ws.openResource(address, o)
	return err
}

func (a api) ActivePath() string {
	if t := a.ws.activeTab(); t != nil && !t.empty {
		return t.path
	}
	return ""
}

func (a api) ActiveTab() (tabtypesapi.Info, bool) {
	if t := a.ws.activeTab(); t != nil && !t.empty {
		return a.ws.props(t, true).Info, true
	}
	return tabtypesapi.Info{}, false
}

func (a api) Display(path string) string { return a.ws.display(path) }

func (a api) RecentFiles() []string { return append([]string(nil), a.ws.recentFiles...) }

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
