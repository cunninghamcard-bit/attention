// Package filetree is the file tree UI plugin: the left dock's Files panel
// (attention's file explorer, apps/web/builtin/FileExplorerView.ts), one
// root per mount. It owns its directory watches and refreshes from the fs
// service's changes.
package filetree

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/watchq"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/appearance"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/layout"
	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// PanelID is the Files panel's slot id.
const PanelID = "file-explorer"

// Plugin registers the Files panel while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "filetree",
	Inject: []string{"shell", "slots", "layout", "workspace", "fs", "project", "actions", "appearance"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh      *shell.Shell
			sl      *slots.Registry
			lyt     *layout.Layout
			ws      *workspace.Workspace
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
		if err := rctx.Use("layout", &lyt); err != nil {
			return err
		}
		if err := rctx.Use("workspace", &ws); err != nil {
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
		tr := newTree(ctx, fs, sh.Update)
		tr.ws = ws
		tr.act = act
		tr.app = app

		reloadMounts := func() {
			go func() {
				ms, err := project.Mounts(ctx)
				if err != nil {
					if ctx.Err() == nil {
						sh.Update(func() { tr.mountsLoaded, tr.notice = true, err.Error() })
					}
					return
				}
				sh.Update(func() { tr.setMounts(ms) })
			}()
		}
		reloadMounts()
		rctx.On(projectplugin.MountsChangedEvent, func(context.Context, ...any) (any, error) {
			reloadMounts()
			return nil, nil
		})
		rctx.On(fsplugin.ChangedEvent, func(_ context.Context, args ...any) (any, error) {
			if len(args) == 0 {
				return nil, nil
			}
			b, err := fsplugin.DecodeBatch(args[0])
			if err != nil {
				return nil, err
			}
			sh.Update(func() { tr.applyBatch(b) })
			return nil, nil
		})
		rctx.On(fsplugin.WatchErrorEvent, func(_ context.Context, args ...any) (any, error) {
			if len(args) > 0 {
				msg := fmt.Sprint(args[0])
				sh.Update(func() { tr.notice = msg })
			}
			return nil, nil
		})

		off := sl.RegisterPanel(slots.Panel{
			ID: PanelID, Title: "Files", Icon: icon.Must("folder"), Dock: slots.Context, Order: 0,
			View:  func(c *ui.Context, _ slots.PanelProps) { tr.view(c) },
			State: tr.state, Restore: tr.restore,
		})
		reveal := func() { lyt.RevealPanel(PanelID) }
		offSection := sl.RegisterSettingsSection(slots.SettingsSection{ID: "file", Title: "Files and links", Icon: icon.Must("folder-cog"), Order: 10,
			Keywords: []string{"Folders", "mount"},
			View:     func(c *ui.Context) { tr.folders(c, project.RemoveMount) }})
		offCmd := act.Add(actions.Command{ID: "file-explorer:open", Title: "Open file explorer", Main: reveal, Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, sh, func() (string, error) { reveal(); return "", nil })
		}})
		rctx.Effect(func(context.Context) error {
			offSection()
			offCmd()
			off()
			tr.watches.Close()
			cancel()
			return nil
		})
		return nil
	},
})

// Tree is the panel's state, on the main thread only.
type Tree struct {
	app     *appearance.Appearance
	ctx     context.Context
	fs      fsplugin.FS
	ws      *workspace.Workspace
	act     *actions.Service
	post    func(func())
	watches *watchq.Queue

	mounts       []projectplugin.Mount
	mountsLoaded bool
	dirs         map[string]*dirNode
	rows         []treeRow
	rowsDirty    bool
	notice       string // a watch error
	// pendingExpanded are session-restored paths to open once they appear
	// as a mount or in a listing. Restore may run before mounts arrive;
	// we do not stat.
	pendingExpanded map[string]bool
}

func newTree(ctx context.Context, fs fsplugin.FS, post func(func())) *Tree {
	tr := &Tree{ctx: ctx, fs: fs, post: post, dirs: map[string]*dirNode{}, rowsDirty: true}
	// A refused watch stays counted: collapsing gives it back and
	// expanding again retries it (watchq).
	tr.watches = watchq.New(ctx, fs, post, func(_, msg string) { tr.notice = msg })
	return tr
}

func (tr *Tree) setMounts(ms []projectplugin.Mount) {
	keep := map[string]bool{}
	for _, m := range ms {
		keep[m.Path] = true
	}
	// A removed mount gives back its watches.
	for _, m := range tr.mounts {
		if !keep[m.Path] {
			tr.forget(m.Path)
		}
	}
	tr.mounts = ms
	tr.mountsLoaded = true
	for _, m := range ms {
		d := tr.dir(m.Path)
		if !d.expanded {
			d.expanded = true
			tr.loadDir(d)
		}
	}
	tr.applyPending()
	tr.rowsDirty = true
}

// forget drops root and the directories under it, unwatching them.
func (tr *Tree) forget(root string) {
	for p, d := range tr.dirs {
		if p == root || isUnder(p, root) {
			if d.watched {
				tr.watches.Unwatch(p)
			}
			delete(tr.dirs, p)
		}
	}
}

func (tr *Tree) dir(path string) *dirNode {
	d, ok := tr.dirs[path]
	if !ok {
		d = &dirNode{path: path}
		tr.dirs[path] = d
	}
	return d
}

func (tr *Tree) state() json.RawMessage {
	seen := map[string]bool{}
	expanded := []string{}
	for p, d := range tr.dirs {
		if d.expanded {
			expanded = append(expanded, p)
			seen[p] = true
		}
	}
	for p := range tr.pendingExpanded {
		if !seen[p] {
			expanded = append(expanded, p)
		}
	}
	sort.Strings(expanded)
	data, _ := json.Marshal(savedState{Expanded: expanded})
	return data
}

// restore remembers expanded paths until those directories become known.
func (tr *Tree) restore(data json.RawMessage) {
	var st savedState
	if json.Unmarshal(data, &st) != nil {
		return
	}
	tr.pendingExpanded = map[string]bool{}
	for _, p := range st.Expanded {
		if p != "" {
			tr.pendingExpanded[p] = true
		}
	}
	tr.applyPending()
}

func (tr *Tree) applyPending() {
	for _, m := range tr.mounts {
		tr.expandIfPending(m.Path)
	}
	for _, d := range tr.dirs {
		for _, e := range d.entries {
			if e.Dir {
				tr.expandIfPending(e.Path)
			}
		}
	}
}

// expandIfPending opens a restored path that has just become known, as a
// user toggle would: loadDir lists and watches it.
func (tr *Tree) expandIfPending(path string) {
	if !tr.pendingExpanded[path] {
		return
	}
	delete(tr.pendingExpanded, path)
	d := tr.dir(path)
	if d.expanded {
		return
	}
	d.expanded = true
	tr.loadDir(d)
	tr.rowsDirty = true
}

// loadDir lists d on a goroutine; an expanded, loaded directory is watched.
func (tr *Tree) loadDir(d *dirNode) {
	if d.loading {
		d.dirty = true
		return
	}
	d.loading = true
	path := d.path
	start := time.Now()
	go func() {
		entries, err := tr.fs.List(tr.ctx, path)
		tr.post(func() {
			debugf("tree: listed %s (%d entries) in %s", path, len(entries), time.Since(start))
			if tr.dirs[path] != d {
				return // forgotten meanwhile (its mount was removed)
			}
			d.loading = false
			if err != nil {
				d.err = err.Error()
				d.entries = nil
			} else {
				d.err = ""
				d.entries = entries
				d.loaded = true
				for _, e := range entries {
					if e.Dir {
						tr.expandIfPending(e.Path)
					}
				}
				// A restored child this listing lacks is gone: forget it,
				// or the session keeps it forever.
				for p := range tr.pendingExpanded {
					if filepath.Dir(p) == path {
						delete(tr.pendingExpanded, p)
					}
				}
			}
			if d.expanded && !d.watched && err == nil {
				d.watched = true
				tr.watches.Watch(path)
			}
			tr.rowsDirty = true
			if d.dirty {
				d.dirty = false
				tr.loadDir(d)
			}
		})
	}()
}

func (tr *Tree) toggleDir(path string) {
	d := tr.dir(path)
	d.expanded = !d.expanded
	if d.expanded {
		tr.loadDir(d) // lists, or refreshes what changed while collapsed; watches once listed
	} else if d.watched {
		d.watched = false
		tr.watches.Unwatch(path)
	}
	tr.rowsDirty = true
}

func (tr *Tree) allCollapsed() bool {
	for _, d := range tr.dirs {
		if d.expanded {
			return false
		}
	}
	return true
}

func (tr *Tree) toggleCollapseAll(collapse bool) {
	if collapse {
		for _, d := range tr.dirs {
			if d.expanded {
				d.expanded = false
				if d.watched {
					d.watched = false
					tr.watches.Unwatch(d.path)
				}
			}
		}
	} else {
		for _, m := range tr.mounts {
			d := tr.dir(m.Path)
			if !d.expanded {
				d.expanded = true
				tr.loadDir(d)
			}
		}
	}
	tr.rowsDirty = true
}

// applyBatch lists again the expanded directories a change touched.
func (tr *Tree) applyBatch(b fsplugin.Batch) {
	seen := map[string]bool{}
	for _, c := range b.Changes {
		dir := filepath.Dir(c.Path)
		if seen[dir] {
			continue
		}
		seen[dir] = true
		if d := tr.dirs[dir]; d != nil && d.loaded && d.expanded {
			tr.loadDir(d)
		}
	}
}

func (tr *Tree) treeRows() []treeRow {
	if !tr.rowsDirty {
		return tr.rows
	}
	tr.rows = tr.rows[:0]
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		d := tr.dirs[dir]
		if d == nil || !d.expanded {
			return
		}
		for _, e := range d.entries {
			tr.rows = append(tr.rows, treeRow{depth: depth, entry: e})
			if e.Dir {
				walk(e.Path, depth+1)
			}
		}
	}
	for i := range tr.mounts {
		m := &tr.mounts[i]
		tr.rows = append(tr.rows, treeRow{depth: 0, entry: fsplugin.Entry{Name: m.Name, Path: m.Path, Dir: true}, mount: m})
		walk(m.Path, 1)
	}
	tr.rowsDirty = false
	return tr.rows
}

func (tr *Tree) view(c *ui.Context) {
	t := c.Theme()
	ws := tr.ws
	rows := tr.treeRows()
	current := ""
	if ws != nil {
		current = ws.ActivePath()
	}
	ui.Column(c).Fill().Children(func() {
		allCollapsed := tr.allCollapsed()
		collapseIcon := icon.Must("chevrons-down-up")
		collapseTip := "Collapse all"
		if allCollapsed {
			collapseIcon = icon.Must("chevrons-up-down")
			collapseTip = "Expand all"
		}
		ui.Row(c).FillWidth().Padding(6, 8, 2, 8).Gap(2).Justify(ui.Center).AlignItems(ui.Center).Children(func() {
			aui.Button(c, aui.ButtonProps{
				Label: "Add folder", Icon: icon.Must("folder-plus"), Variant: aui.ButtonGhost, Size: aui.ButtonIconSmall,
				OnClick: func() {
					if cmd := tr.act.Lookup("workspace:add-folder"); cmd != nil {
						go func() {
							if _, err := cmd.Run(tr.ctx, actions.Args{Params: map[string]string{}}); err != nil && tr.ctx.Err() == nil {
								tr.post(func() { tr.notice = err.Error() })
							}
						}()
					}
				},
			}).Tooltip("Add folder to workspace")
			aui.Button(c, aui.ButtonProps{
				Label: collapseTip, Icon: collapseIcon, Variant: aui.ButtonGhost, Size: aui.ButtonIconSmall,
				OnClick: func() { tr.toggleCollapseAll(!allCollapsed) },
			}).Tooltip(collapseTip)
		})
		if tr.notice != "" {
			ui.Text(c, tr.notice).FontSize(11).TextColor(t.Warning).Padding(4, 12)
		}
		if !tr.mountsLoaded {
			ui.Text(c, "Loading…").TextColor(t.TextMuted).Padding(8, 12)
			return
		}
		app := tr.app.Settings()
		rowH := float32(26)
		if app.TreeDensity == "comfortable" {
			rowH = 30
		}
		ui.List(c, nil, len(rows), func(i int) {
			r := rows[i]
			e := r.entry
			selected := !e.Dir && e.Path == current
			row := aui.SideRow(c, aui.SideRowProps{Key: e.Path, Selected: selected, Depth: r.depth, Height: rowH, Guides: app.ShowGuides})
			if row.Clicked() {
				if e.Dir {
					tr.toggleDir(e.Path)
				} else if ws != nil {
					// Mod-click opens a new tab (attention's Keymap.isModEvent).
					ws.Open(e.Path, nil, row.ClickModifiers()&ui.Cmd != 0)
				}
			}
			if ws != nil {
				row.Tooltip(ws.Display(e.Path))
			}
			row.Children(func() {
				if e.Dir {
					d := tr.dirs[e.Path]
					open := d != nil && d.expanded
					if !tr.app.Icons().Show {
						aui.Disclosure(c, open, 12)
					} else {
						tr.app.Icons().Render(c, e.Name, true, open, t.Dark, 15)
					}
				} else {
					if !tr.app.Icons().Show {
						ui.Box(c).Width(12).Shrink(0)
					} else {
						tr.app.Icons().Render(c, e.Name, false, false, t.Dark, 15)
					}
				}
				label := ui.Text(c, e.Name).SingleLine().Ellipsis("…").Shrink(1).FontSize(13).LineHeight(1.35)
				if r.mount != nil {
					label.FontWeight(600).TextColor(t.Text)
				} else if selected {
					label.FontWeight(500)
				}
				if e.Dir {
					if d := tr.dirs[e.Path]; d != nil && d.err != "" {
						ui.Icon(c, icon.Must("triangle-alert")).Size(12, 12).TextColor(t.Warning).Shrink(0).Tooltip(d.err)
					}
				}
			})
		}).Grow(1).FillWidth().Padding(4, 6)
	})
}

// folders is the Files and links tab (FilesSettingTab), which holds only
// the folders in the workspace: the mounts, each removable, and
// Add folder (workspace:add-folder). The tree follows the project's
// mounts-changed event.
func (tr *Tree) folders(c *ui.Context, remove func(context.Context, string) error) {
	t := c.Theme()
	aui.SettingsSection(c, "Folders in the workspace", func() {
		if len(tr.mounts) == 0 {
			ui.Text(c, "No folders").FontSize(12).TextColor(t.TextMuted)
		}
		for _, m := range tr.mounts {
			id := m.ID
			aui.PreferenceRow(c, m.Name, m.Path, func() {
				aui.Button(c, aui.ButtonProps{Label: "Remove", Variant: aui.ButtonSecondary, OnClick: func() {
					go func() {
						if err := remove(tr.ctx, id); err != nil && tr.ctx.Err() == nil {
							tr.post(func() { tr.notice = err.Error() })
						}
					}()
				}})
			})
		}
	})
	aui.Button(c, aui.ButtonProps{Label: "Add folder", Icon: icon.Must("folder-plus"), Variant: aui.ButtonSecondary, OnClick: func() {
		if cmd := tr.act.Lookup("workspace:add-folder"); cmd != nil {
			go func() {
				if _, err := cmd.Run(tr.ctx, actions.Args{Params: map[string]string{}}); err != nil && tr.ctx.Err() == nil {
					tr.post(func() { tr.notice = err.Error() })
				}
			}()
		}
	}})
}

// savedState is the Files panel's session: which directories are open.
type savedState struct {
	Expanded []string `json:"expanded"`
}

type dirNode struct {
	path     string
	expanded bool
	loaded   bool // listed successfully at least once
	loading  bool
	dirty    bool // a change arrived while loading: list again after
	watched  bool // we hold one watch on it
	entries  []fsplugin.Entry
	err      string
}

type treeRow struct {
	depth int
	entry fsplugin.Entry
	mount *projectplugin.Mount // set on a mount's root row
}

func isUnder(path, dir string) bool {
	return strings.HasPrefix(path, dir+string(filepath.Separator))
}

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
