package workspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

// Size limits for what a tab reads.
const (
	maxTextBytes  = 8 << 20
	maxImageBytes = 50 << 20
)

type tabKind int

const (
	kindText tabKind = iota
	kindMarkdown
	kindImage
	kindSearch
)

// Workspace is the window's whole state. Every field is read and written on
// the main thread only: work done on goroutines comes back through
// shellapi.Update (RFC §5.8).
type Workspace struct {
	ctx     context.Context
	fs      fscontract.FS
	project projectcontract.Project

	mounts       []projectcontract.Mount
	mountsLoaded bool
	dirs         map[string]*dirNode
	rows         []treeRow
	rowsDirty    bool
	watching     map[string]int // directory -> our own watch count

	panelOpen bool
	leftWidth float32
	panes     []*pane
	active    int
	splitPct  float32

	palette *palette
	notice  string // a workspace-wide message, as a watch error

	files     *projectcontract.Listing // last quick-open listing
	filesBusy bool

	nextTab       int
	restoring     []sessionPane // tabs to reopen once the mounts are known
	restoreActive int
	saveSoon      func()
	title         string
}

type dirNode struct {
	path     string
	expanded bool
	loaded   bool
	loading  bool
	entries  []fscontract.Entry
	err      string
}

type treeRow struct {
	depth   int
	entry   fscontract.Entry
	mount   *projectcontract.Mount // set on a mount's root row
	display string
}

type pane struct {
	tabs   []*tab
	active int
}

type tab struct {
	id    int
	kind  tabKind
	path  string
	title string

	loading bool
	err     string
	missing bool // the file was deleted or moved away
	notice  string
	reloads int // reload requests while a load was running

	file fscontract.File
	ed   *editor.State // text, and markdown's source view

	mdSource bool // markdown shows its source instead of the rendered view
	md       markdown.Options

	img ui.ImageSource

	search *searchState

	// nav is a pending line=/to= for when the content arrives.
	nav *navTarget
}

type navTarget struct{ line, to int } // 1-based; to 0 means line alone

func newWorkspace(ctx context.Context, fs fscontract.FS, project projectcontract.Project) *Workspace {
	return &Workspace{
		ctx: ctx, fs: fs, project: project,
		dirs:      map[string]*dirNode{},
		watching:  map[string]int{},
		panelOpen: true,
		leftWidth: 260,
		panes:     []*pane{{}},
		splitPct:  50,
		rowsDirty: true,
	}
}

func kindFor(path string) tabKind {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".md", ".markdown", ".mdx":
		return kindMarkdown
	case ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg":
		return kindImage
	}
	return kindText
}

func (ws *Workspace) activePane() *pane {
	if ws.active >= len(ws.panes) {
		ws.active = len(ws.panes) - 1
	}
	return ws.panes[ws.active]
}

func (p *pane) current() *tab {
	if len(p.tabs) == 0 {
		return nil
	}
	if p.active >= len(p.tabs) {
		p.active = len(p.tabs) - 1
	}
	return p.tabs[p.active]
}

// activeTab is the active pane's active tab, or nil.
func (ws *Workspace) activeTab() *tab { return ws.activePane().current() }

// mountOf returns the mount holding path and path relative to it.
func (ws *Workspace) mountOf(path string) (projectcontract.Mount, string, bool) {
	best := -1
	for i, m := range ws.mounts {
		if path == m.Path || strings.HasPrefix(path, m.Path+string(filepath.Separator)) {
			if best < 0 || len(m.Path) > len(ws.mounts[best].Path) {
				best = i
			}
		}
	}
	if best < 0 {
		return projectcontract.Mount{}, "", false
	}
	rel, _ := filepath.Rel(ws.mounts[best].Path, path)
	return ws.mounts[best], filepath.ToSlash(rel), true
}

// display is a path as the CLI and the tabs' tooltips show it.
func (ws *Workspace) display(path string) string {
	if m, rel, ok := ws.mountOf(path); ok {
		if rel == "." {
			return m.Name
		}
		return projectcontract.Display(m, rel)
	}
	return path
}

// ---- watching ---------------------------------------------------------------

func (ws *Workspace) watch(dir string) {
	ws.watching[dir]++
	if ws.watching[dir] > 1 {
		return
	}
	go func() {
		if err := ws.fs.Watch(ws.ctx, dir); err != nil && ws.ctx.Err() == nil {
			msg := err.Error()
			shellapi.Update(func() { ws.notice = msg })
		}
	}()
}

func (ws *Workspace) unwatch(dir string) {
	switch ws.watching[dir] {
	case 0:
		return
	case 1:
		delete(ws.watching, dir)
		go func() { _ = ws.fs.Unwatch(ws.ctx, dir) }()
	default:
		ws.watching[dir]--
	}
}

// ---- tree -------------------------------------------------------------------

func (ws *Workspace) setMounts(ms []projectcontract.Mount) {
	ws.mounts = ms
	ws.mountsLoaded = true
	for _, m := range ms {
		d := ws.dir(m.Path)
		if !d.expanded {
			d.expanded = true
			ws.loadDir(d)
		}
	}
	ws.rowsDirty = true
	if ws.restoring != nil {
		ws.reopen(ws.restoring)
		ws.restoring = nil
	}
}

func (ws *Workspace) dir(path string) *dirNode {
	d, ok := ws.dirs[path]
	if !ok {
		d = &dirNode{path: path}
		ws.dirs[path] = d
	}
	return d
}

// loadDir lists d on a goroutine; an expanded, loaded directory is watched.
func (ws *Workspace) loadDir(d *dirNode) {
	if d.loading {
		return
	}
	d.loading = true
	path := d.path
	go func() {
		entries, err := ws.fs.List(ws.ctx, path)
		shellapi.Update(func() {
			d.loading = false
			if err != nil {
				d.err = err.Error()
				d.entries = nil
			} else {
				d.err = ""
				d.entries = entries
			}
			if !d.loaded && d.expanded && err == nil {
				ws.watch(path)
			}
			d.loaded = err == nil
			ws.rowsDirty = true
		})
	}()
}

func (ws *Workspace) toggleDir(path string) {
	d := ws.dir(path)
	d.expanded = !d.expanded
	if d.expanded {
		if d.loaded {
			ws.watch(path)
			ws.loadDir(d) // refresh what changed while collapsed
		} else {
			ws.loadDir(d)
		}
	} else if d.loaded {
		ws.unwatch(path)
	}
	ws.rowsDirty = true
}

func (ws *Workspace) treeRows() []treeRow {
	if !ws.rowsDirty {
		return ws.rows
	}
	ws.rows = ws.rows[:0]
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		d := ws.dirs[dir]
		if d == nil || !d.expanded {
			return
		}
		for _, e := range d.entries {
			ws.rows = append(ws.rows, treeRow{depth: depth, entry: e})
			if e.Dir {
				walk(e.Path, depth+1)
			}
		}
	}
	for i := range ws.mounts {
		m := &ws.mounts[i]
		ws.rows = append(ws.rows, treeRow{depth: 0, entry: fscontract.Entry{Name: m.Name, Path: m.Path, Dir: true}, mount: m})
		walk(m.Path, 1)
	}
	ws.rowsDirty = false
	return ws.rows
}

// ---- tabs -------------------------------------------------------------------

// open shows path in the active pane, reusing a tab that already shows it,
// and applies nav when given.
func (ws *Workspace) open(path string, nav *navTarget) *tab {
	p := ws.activePane()
	for i, t := range p.tabs {
		if t.kind != kindSearch && t.path == path {
			p.active = i
			if nav != nil {
				t.nav = nav
				ws.applyNav(t)
			}
			ws.changed()
			return t
		}
	}
	ws.nextTab++
	t := &tab{id: ws.nextTab, kind: kindFor(path), path: path, title: filepath.Base(path), nav: nav}
	t.md.OnLink = func(url string) { ws.followLink(t, url) }
	t.md.LoadImage = markdown.FileImages(filepath.Dir(path))
	at := p.active + 1
	if len(p.tabs) == 0 {
		at = 0
	}
	p.tabs = append(p.tabs[:at], append([]*tab{t}, p.tabs[at:]...)...)
	p.active = at
	ws.watch(filepath.Dir(path))
	ws.load(t)
	ws.changed()
	return t
}

// load reads t's content on a goroutine.
func (ws *Workspace) load(t *tab) {
	if t.loading {
		t.reloads++
		return
	}
	t.loading = true
	kind, path := t.kind, t.path
	go func() {
		var (
			file fscontract.File
			img  ui.ImageSource
			err  error
		)
		if kind == kindImage {
			var data []byte
			data, err = ws.fs.ReadBytes(ws.ctx, path, maxImageBytes)
			if err == nil {
				if strings.EqualFold(filepath.Ext(path), ".svg") {
					img, err = ui.ParseSVG(data)
				} else {
					img, err = ui.DecodeBitmap(data)
				}
			}
		} else {
			file, err = ws.fs.Read(ws.ctx, path, maxTextBytes)
		}
		shellapi.Update(func() { ws.loaded(t, file, img, err) })
	}()
}

func (ws *Workspace) loaded(t *tab, file fscontract.File, img ui.ImageSource, err error) {
	t.loading = false
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			t.missing = true
		} else {
			t.err = err.Error()
		}
	} else {
		t.err, t.missing = "", false
		switch t.kind {
		case kindImage:
			t.img = img
		default:
			t.file = file
			t.setText(file)
			ws.applyNav(t)
		}
	}
	if t.reloads > 0 {
		t.reloads = 0
		ws.load(t)
	}
}

// setText puts the file's text in the tab, keeping the first visible line
// when the text is replaced on a refresh.
func (t *tab) setText(f fscontract.File) {
	if f.Binary || f.TooLarge {
		t.ed = nil
		return
	}
	if t.ed == nil {
		buf := editor.NewBuffer(f.Text)
		buf.SetLanguage(editor.LanguageFor(t.path))
		t.ed = &editor.State{Buffer: buf, ReadOnly: true}
		return
	}
	first, _ := t.ed.VisibleLines()
	t.ed.Buffer.Reset(f.Text)
	if first > 0 {
		t.ed.ScrollTo(min(first, max(0, t.ed.Buffer.LineCount()-1)))
	}
}

// applyNav moves the editor to the pending line=/to= once there is text.
func (ws *Workspace) applyNav(t *tab) {
	if t.nav == nil || t.ed == nil {
		return
	}
	if t.kind == kindMarkdown {
		t.mdSource = true // a passage is shown in the source
	}
	n := *t.nav
	t.nav = nil
	lines := t.ed.Buffer.LineCount()
	from := min(n.line, lines) - 1
	to := from
	if n.to > 0 {
		to = min(n.to, lines) - 1
	}
	start := t.ed.Buffer.Offset(editor.Pos{Line: from})
	end := t.ed.Buffer.Offset(editor.Pos{Line: to, Col: len(t.ed.Buffer.Line(to))})
	t.ed.GoTo(editor.Pos{Line: from})
	t.ed.Select(start, end)
}

func (ws *Workspace) closeTab(p *pane, i int) {
	if i < 0 || i >= len(p.tabs) {
		return
	}
	t := p.tabs[i]
	if t.kind != kindSearch {
		ws.unwatch(filepath.Dir(t.path))
	} else if t.search != nil && t.search.cancel != nil {
		t.search.cancel()
	}
	p.tabs = append(p.tabs[:i], p.tabs[i+1:]...)
	if p.active > i || p.active >= len(p.tabs) {
		p.active = max(0, p.active-1)
	}
	// An empty second pane closes.
	if len(p.tabs) == 0 && len(ws.panes) > 1 {
		for j, q := range ws.panes {
			if q == p {
				ws.panes = append(ws.panes[:j], ws.panes[j+1:]...)
				break
			}
		}
		ws.active = 0
	}
	ws.changed()
}

func (ws *Workspace) closeActiveTab() {
	p := ws.activePane()
	ws.closeTab(p, p.active)
}

func (ws *Workspace) cycleTab(delta int) {
	p := ws.activePane()
	if n := len(p.tabs); n > 1 {
		p.active = ((p.active+delta)%n + n) % n
		ws.changed()
	}
}

// splitRight opens a second pane showing the active tab's file, or moves the
// focus between the two panes when there are two.
func (ws *Workspace) splitRight() {
	if len(ws.panes) > 1 {
		ws.active = 1 - ws.active
		ws.changed()
		return
	}
	t := ws.activeTab()
	ws.panes = append(ws.panes, &pane{})
	ws.active = 1
	if t != nil && t.kind != kindSearch {
		ws.open(t.path, nil)
	}
	ws.changed()
}

// followLink opens a markdown link: a relative path or file: URL as a
// file, a #fragment does nothing here, other schemes open outside.
func (ws *Workspace) followLink(from *tab, url string) {
	if strings.HasPrefix(url, "#") {
		return
	}
	if strings.Contains(url, "://") && !strings.HasPrefix(url, "file://") {
		openExternal(url)
		return
	}
	p := strings.TrimPrefix(strings.TrimPrefix(url, "file://"), "file:")
	if i := strings.IndexByte(p, '#'); i >= 0 {
		p = p[:i]
	}
	if !filepath.IsAbs(p) {
		p = filepath.Join(filepath.Dir(from.path), p)
	}
	ws.open(filepath.Clean(p), nil)
}

// ---- changes ----------------------------------------------------------------

// applyBatch refreshes the listings and the open tabs a change touched. A
// path removed or renamed away that exists again (an editor's atomic save
// renames over it) reloads instead of going missing.
func (ws *Workspace) applyBatch(b fscontract.Batch) {
	dirs := map[string]bool{}
	files := map[string]string{}
	for _, c := range b.Changes {
		dirs[filepath.Dir(c.Path)] = true
		files[c.Path] = c.Op
	}
	for dir := range dirs {
		if d := ws.dirs[dir]; d != nil && d.loaded && d.expanded {
			ws.loadDir(d)
		}
	}
	for _, p := range ws.panes {
		for _, t := range p.tabs {
			op, ok := files[t.path]
			if !ok || t.kind == kindSearch {
				continue
			}
			if op == "remove" || op == "rename" {
				ws.recheck(t)
				continue
			}
			t.missing = false
			ws.load(t)
		}
	}
}

// recheck reloads a tab whose file still exists and marks it missing
// otherwise.
func (ws *Workspace) recheck(t *tab) {
	path := t.path
	go func() {
		_, err := ws.fs.Stat(ws.ctx, path)
		shellapi.Update(func() {
			if err != nil {
				t.missing = true
				return
			}
			t.missing = false
			ws.load(t)
		})
	}()
}

// changed notes a layout change: the window title and the saved session.
func (ws *Workspace) changed() {
	if ws.saveSoon != nil {
		ws.saveSoon()
	}
	title := "attention"
	if t := ws.activeTab(); t != nil {
		if t.kind == kindSearch {
			title = "Search — attention"
		} else {
			title = ws.display(t.path) + " — attention"
		}
	}
	if title != ws.title {
		ws.title = title
		if w := shellapi.Window(); w != nil {
			w.SetTitle(title)
		}
	}
}
