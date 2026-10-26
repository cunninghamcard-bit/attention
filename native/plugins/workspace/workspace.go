package workspace

import (
	"context"
	"errors"
	"fmt"
	neturl "net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/internal/watchq"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
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
	kindEmpty // a new tab, until a file opens in it
)

// maxClosed is how many closed tabs Undo close tab can bring back.
const maxClosed = 20

// Workspace is the window's whole state. Every field is read and written on
// the main thread only: work done on goroutines comes back through
// shellapi.Update (RFC §5.8).
type Workspace struct {
	ctx     context.Context
	fs      fscontract.FS
	project projectcontract.Project

	mounts       []projectcontract.Mount
	mountsLoaded bool
	watches      *watchq.Queue // the open tabs' directories

	panelOpen  bool
	leftWidth  float32
	leftPanel  string // the left dock's shown panel (slotsapi.Panel.ID)
	reveals    map[string]int
	rightOpen  bool
	rightWidth float32
	panes      []*pane
	active     int
	splitPct   float32
	seenLeft   float32 // the widths last saved, to notice a divider drag
	seenSplit  float32

	palette *palette
	notice  string // a workspace-wide message, as a watch error

	files     *projectcontract.Listing // last quick-open listing
	filesBusy bool

	nextTab int
	closed  []string // recently closed files, newest last
	// The quick switcher's recent files and the command palette's recent
	// commands, newest first.
	recentFiles    []string
	recentCommands []string
	restoring      []sessionPane // tabs to reopen once the mounts are known
	restoreActive  int
	saveSoon       func()
	isDark         func() bool // mygo.Theme.IsDark; tests replace it
	title          string
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

	// nav is where to go once the content arrives.
	nav *workspaceapi.Nav
}

func newWorkspace(ctx context.Context, fs fscontract.FS, project projectcontract.Project) *Workspace {
	ws := &Workspace{
		ctx: ctx, fs: fs, project: project,
		panelOpen:  true,
		leftWidth:  260,
		rightWidth: 260,
		reveals:    map[string]int{},
		panes:      []*pane{{}},
		splitPct:   50,
		isDark:     mygo.Theme.IsDark,
	}
	ws.watches = watchq.New(ctx, fs, shellapi.Update, func(_, msg string) {
		shellapi.Update(func() { ws.notice = msg })
	})
	return ws
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

// ---- mounts -----------------------------------------------------------------

func (ws *Workspace) setMounts(ms []projectcontract.Mount) {
	ws.mounts = ms
	ws.mountsLoaded = true
	if ws.restoring != nil {
		ws.reopen(ws.restoring)
		ws.restoring = nil
	}
}

// ---- tabs -------------------------------------------------------------------

// open shows path in the active pane, reusing a tab that already shows it,
// and applies nav when given.
func (ws *Workspace) open(path string, nav *workspaceapi.Nav) *tab {
	return ws.openIn(path, nav, false)
}

// openIn is open; newTab opens another tab even when one shows path.
func (ws *Workspace) openIn(path string, nav *workspaceapi.Nav, newTab bool) *tab {
	p := ws.activePane()
	// A file opens in the active new tab, as a browser's address does.
	if cur := p.current(); cur != nil && cur.kind == kindEmpty && !newTab {
		p.tabs = append(p.tabs[:p.active], p.tabs[p.active+1:]...)
		p.active = max(0, p.active-1)
		if len(p.tabs) > 0 {
			p.active = min(p.active, len(p.tabs)-1)
		}
	}
	for i, t := range p.tabs {
		if !newTab && t.kind != kindEmpty && t.path == path {
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
	ws.watches.Watch(filepath.Dir(path))
	ws.load(t)
	ws.noteRecentFile(path)
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
	start := time.Now()
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
		shellapi.Update(func() {
			ws.loaded(t, file, img, err)
			debugf("tab: loaded %s in %s", filepath.Base(path), time.Since(start))
		})
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
	// Keep where the reader was: the first visible line and the carets,
	// by line and column, clamped to the new text.
	first, _ := t.ed.VisibleLines()
	type caret struct{ anchor, head editor.Pos }
	var carets []caret
	for _, s := range t.ed.Selections() {
		carets = append(carets, caret{t.ed.Buffer.Pos(s.Anchor), t.ed.Buffer.Pos(s.Head)})
	}
	t.ed.Buffer.Reset(f.Text)
	clamp := func(p editor.Pos) int {
		lines := t.ed.Buffer.LineCount()
		p.Line = max(0, min(p.Line, lines-1))
		p.Col = max(0, min(p.Col, len(t.ed.Buffer.Line(p.Line))))
		return t.ed.Buffer.Offset(p)
	}
	if len(carets) > 0 {
		sels := make([]editor.Selection, len(carets))
		for i, c := range carets {
			sels[i] = editor.Selection{Anchor: clamp(c.anchor), Head: clamp(c.head)}
		}
		t.ed.SetSelections(sels...)
	}
	if first > 0 {
		t.ed.ScrollTo(min(first, max(0, t.ed.Buffer.LineCount()-1)))
	}
}

// applyNav moves the editor to the pending nav once there is text: a
// match (Col, Len) is selected, else lines Line through To.
func (ws *Workspace) applyNav(t *tab) {
	if t.nav == nil || t.ed == nil {
		return
	}
	if t.kind == kindMarkdown {
		t.mdSource = true // a passage is shown in the source
	}
	n := *t.nav
	t.nav = nil
	buf := t.ed.Buffer
	lines := buf.LineCount()
	from := max(1, min(n.Line, lines)) - 1
	if n.Col > 0 {
		text := buf.Line(from)
		col := min(n.Col-1, len(text))
		end := min(col+n.Len, len(text))
		t.ed.GoTo(editor.Pos{Line: from, Col: col})
		t.ed.Select(buf.Offset(editor.Pos{Line: from, Col: col}), buf.Offset(editor.Pos{Line: from, Col: end}))
		return
	}
	to := from
	if n.To > 0 {
		to = max(from, min(n.To, lines)-1)
	}
	start := buf.Offset(editor.Pos{Line: from})
	end := buf.Offset(editor.Pos{Line: to, Col: len(buf.Line(to))})
	t.ed.GoTo(editor.Pos{Line: from})
	t.ed.Select(start, end)
}

func (ws *Workspace) closeTab(p *pane, i int) {
	if i < 0 || i >= len(p.tabs) {
		return
	}
	t := p.tabs[i]
	if t.kind != kindEmpty {
		ws.watches.Unwatch(filepath.Dir(t.path))
		ws.closed = append(ws.closed, t.path)
		if len(ws.closed) > maxClosed {
			ws.closed = ws.closed[len(ws.closed)-maxClosed:]
		}
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
	if t != nil && t.kind != kindEmpty {
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
	p := url
	if strings.HasPrefix(url, "file:") {
		u, err := neturl.Parse(url)
		if err != nil {
			return
		}
		p = u.Path
	} else if i := strings.IndexAny(p, "#?"); i >= 0 {
		p = p[:i]
	}
	if decoded, err := neturl.PathUnescape(p); err == nil {
		p = decoded
	}
	if !filepath.IsAbs(p) {
		p = filepath.Join(filepath.Dir(from.path), p)
	}
	ws.open(filepath.Clean(p), nil)
}

// ---- changes ----------------------------------------------------------------

// applyBatch refreshes the open tabs a change touched. A path removed or renamed away that exists again (an editor's atomic save
// renames over it) reloads instead of going missing.
func (ws *Workspace) applyBatch(b fscontract.Batch) {
	files := map[string]string{}
	for _, c := range b.Changes {
		files[c.Path] = c.Op
	}
	for _, p := range ws.panes {
		for _, t := range p.tabs {
			op, ok := files[t.path]
			if !ok || t.kind == kindEmpty {
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
		if t.kind == kindEmpty {
			title = t.title + " — attention"
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

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}

// newTab opens an empty tab after the active one.
func (ws *Workspace) newTab() {
	p := ws.activePane()
	ws.nextTab++
	t := &tab{id: ws.nextTab, kind: kindEmpty, title: "New tab"}
	at := min(p.active+1, len(p.tabs))
	p.tabs = append(p.tabs[:at], append([]*tab{t}, p.tabs[at:]...)...)
	p.active = at
	ws.changed()
}

// undoClose reopens the most recently closed file.
func (ws *Workspace) undoClose() {
	if n := len(ws.closed); n > 0 {
		path := ws.closed[n-1]
		ws.closed = ws.closed[:n-1]
		ws.open(path, nil)
	}
}

// gotoTab activates the n-th tab (1-based) of the active pane; n < 1 is
// the last tab.
func (ws *Workspace) gotoTab(n int) {
	p := ws.activePane()
	if len(p.tabs) == 0 {
		return
	}
	if n < 1 || n > len(p.tabs) {
		n = len(p.tabs)
	}
	p.active = n - 1
	ws.changed()
}

func (ws *Workspace) toggleLeft() {
	ws.panelOpen = !ws.panelOpen
	ws.changed()
}

func (ws *Workspace) toggleRight() {
	ws.rightOpen = !ws.rightOpen
	ws.changed()
}

// revealPanel opens the dock holding the panel and shows it; its view
// sees the reveal (PanelProps.Reveal) and focuses its input.
func (ws *Workspace) revealPanel(id string) {
	for _, d := range []slotsapi.Dock{slotsapi.Left, slotsapi.Right} {
		for _, p := range slotsapi.Panels(d) {
			if p.ID != id {
				continue
			}
			if d == slotsapi.Left {
				ws.panelOpen, ws.leftPanel = true, id
			} else {
				ws.rightOpen = true
			}
			ws.reveals[id]++
			ws.changed()
			return
		}
	}
}
