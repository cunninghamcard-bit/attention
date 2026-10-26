// Package workspace is the workspace UI plugin: the Zed-looking reader —
// project panel, tabbed panes with a split, read-only text, Markdown and
// image views, quick open, the command palette, project search, the status
// bar — and the CLI's open and tabs.
//
// TODO(RFC §5.5–§5.7): tab bodies, panels and the palette become slot,
// tabTypes and navigation contributions once there are other UI plugins.
package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

// onMain runs fn on the main thread and waits for it. It must not be called
// from the main thread.
func onMain[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	type result struct {
		v   T
		err error
	}
	if shellapi.Window() == nil {
		var zero T
		return zero, fmt.Errorf("the window is closed")
	}
	done := make(chan result, 1)
	shellapi.Update(func() {
		v, err := fn()
		done <- result{v, err}
	})
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	select {
	case r := <-done:
		return r.v, r.err
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	case <-timer.C:
		var zero T
		return zero, fmt.Errorf("the window did not respond")
	}
}

func openExternal(url string) {
	go func() { _ = mygo.Shell.OpenExternal(url) }()
}

// Plugin draws the window's content while loaded.
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

		// Saving: debounced, the snapshot taken on the main thread and the
		// write done off it.
		// writeMu orders the writes, so the final save on unload is the
		// last one; saveClosed stops the timer's saves after it.
		var saveMu, writeMu sync.Mutex
		var saveTimer *time.Timer
		saveClosed := false
		write := func(s session) {
			writeMu.Lock()
			defer writeMu.Unlock()
			_ = saveSession(s)
		}
		ws.saveSoon = func() {
			saveMu.Lock()
			defer saveMu.Unlock()
			if saveClosed {
				return
			}
			if saveTimer != nil {
				saveTimer.Stop()
			}
			saveTimer = time.AfterFunc(400*time.Millisecond, func() {
				shellapi.Update(func() {
					saveMu.Lock()
					closed := saveClosed
					saveMu.Unlock()
					if closed {
						return
					}
					s := ws.snapshot()
					go write(s)
				})
			})
		}

		// Restore the layout, then the mounts (which reopen the tabs).
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

		rctx.On(fscontract.ChangedEvent, func(_ context.Context, args ...any) (any, error) {
			if len(args) == 0 {
				return nil, nil
			}
			b, err := fscontract.DecodeBatch(args[0])
			if err != nil {
				return nil, err
			}
			shellapi.Update(func() { ws.applyBatch(b) })
			return nil, nil
		})
		rctx.On(fscontract.WatchErrorEvent, func(_ context.Context, args ...any) (any, error) {
			if len(args) > 0 {
				msg := fmt.Sprint(args[0])
				shellapi.Update(func() { ws.notice = msg })
			}
			return nil, nil
		})
		rctx.On(projectcontract.MountsChangedEvent, func(context.Context, ...any) (any, error) {
			reloadMounts()
			return nil, nil
		})

		for _, cmd := range ws.commands() {
			off := actionsapi.Register(cmd)
			rctx.Effect(func(context.Context) error { off(); return nil })
		}

		offRoot := shellapi.SetRoot(ws.view)
		rctx.Effect(func(context.Context) error {
			if os.Getenv("ATTENTION_DEBUG") != "" {
				fmt.Fprintln(os.Stderr, "[debug] workspace: cleanup start")
				defer fmt.Fprintln(os.Stderr, "[debug] workspace: cleanup end")
			}
			offRoot()
			// Save the final layout; the shell is still loaded (we inject it),
			// and the run loop runs until every plugin has unloaded.
			s, err := onMain(context.Background(), func() (session, error) { return ws.snapshot(), nil })
			saveMu.Lock()
			saveClosed = true
			if saveTimer != nil {
				saveTimer.Stop()
			}
			saveMu.Unlock()
			if err == nil {
				write(s)
			}
			cancel()
			return nil
		})
		return nil
	},
})

// commands are the workspace's palette and CLI commands. Run is always
// called off the main thread (the palette starts a goroutine; the CLI runs
// on its connection's), so it hops to the main thread with onMain.
func (ws *Workspace) commands() []actionsapi.Command {
	ui := func(id, title, keys string, fn func()) actionsapi.Command {
		return actionsapi.Command{ID: id, Title: title, Keys: keys, Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			return onMain(ctx, func() (string, error) { fn(); return "", nil })
		}}
	}
	return []actionsapi.Command{
		ui("file-finder:toggle", "File Finder: Toggle", "Ctrl P", func() { ws.openPalette(modeFiles) }),
		ui("project-search:deploy", "Project Search: Deploy", "Ctrl Shift F", func() { ws.openSearch() }),
		ui("go-to-line:toggle", "Go to Line: Toggle", "Ctrl G", func() { ws.openPalette(modeLine) }),
		ui("pane:close-active-item", "Pane: Close Active Item", "Ctrl W", ws.closeActiveTab),
		ui("pane:split-right", "Pane: Split Right", "Ctrl \\", ws.splitRight),
		ui("pane:activate-next-item", "Pane: Activate Next Item", "Ctrl Tab", func() { ws.cycleTab(1) }),
		ui("pane:activate-prev-item", "Pane: Activate Previous Item", "Ctrl Shift Tab", func() { ws.cycleTab(-1) }),
		ui("project-panel:toggle", "Project Panel: Toggle", "Ctrl B", func() { ws.panelOpen = !ws.panelOpen; ws.changed() }),
		ui("markdown:toggle-source", "Markdown: Toggle Source", "Ctrl Shift V", func() {
			if tb := ws.activeTab(); tb != nil && tb.kind == kindMarkdown {
				tb.mdSource = !tb.mdSource
			}
		}),
		{ID: "workspace:add-folder", Title: "Workspace: Add Folder to Project", Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			dirs, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: shellapi.Window(), Title: "Add Folder to Project", Directory: true})
			if err != nil || len(dirs) == 0 {
				return "", err
			}
			_, err = ws.project.AddMount(ctx, dirs[0])
			return "", err
		}},
		{ID: "focus", CLI: true, Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			return onMain(ctx, func() (string, error) {
				if w := shellapi.Window(); w != nil {
					w.Show()
					w.Focus()
				}
				return "", nil
			})
		}},
		{ID: "open", CLI: true, Run: ws.cliOpen},
		{ID: "quit", Title: "Workspace: Quit", Keys: "Ctrl Q", CLI: true, Run: func(context.Context, actionsapi.Args) (string, error) {
			// The same path as the user closing the window: App.Run returns
			// and the UI runtime asks rutis-host to stop.
			mygo.App.Quit()
			return "Quitting.", nil
		}},
		{ID: "tabs", CLI: true, Run: func(ctx context.Context, a actionsapi.Args) (string, error) {
			return onMain(ctx, func() (string, error) {
				// The TS CLI's shape: "[<view type>] <display text>", then a tab
				// ID with ids.
				var lines []string
				for _, p := range ws.panes {
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
	}
}

// viewType names a tab's view as the TS CLI's tabs does.
func (t *tab) viewType() string {
	switch t.kind {
	case kindMarkdown:
		return "markdown"
	case kindImage:
		return "image"
	case kindSearch:
		return "search"
	}
	return "text"
}

// displayText is a tab's name as the TS CLI shows it: a note without its
// extension, any other file by its base name.
func (t *tab) displayText() string {
	if t.kind == kindMarkdown {
		return strings.TrimSuffix(t.title, filepath.Ext(t.title))
	}
	return t.title
}

// cliOpen is `open path=<path> | file=<name> [line=<n> [to=<n>]] [newtab]`,
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
	return onMain(ctx, func() (string, error) {
		var nav *navTarget
		if hasLine {
			nav = &navTarget{line: line, to: to}
		}
		ws.openIn(target, nav, a.Has("newtab"))
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
