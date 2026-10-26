package workspace

import (
	"github.com/cunninghamcard-bit/attention/native/internal/fileicon"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/internal/fuzzy"
	"github.com/cunninghamcard-bit/attention/native/internal/natural"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

type paletteMode int

const (
	modeFiles paletteMode = iota
	modeCommands
	modeLine
)

// maxResults is SuggestModal's limit (apps/web/ui/suggest/SuggestModal.ts).
const maxResults = 100

// maxRecentFiles and maxRecentCommands are the quick switcher's recent list
// (getRecentFiles maxCount) and the command palette's recentCommands cap.
const (
	maxRecentFiles    = 10
	maxRecentCommands = 100
)

type palette struct {
	mode     paletteMode
	query    string
	ranked   string // the query results were ranked for
	selected int
	results  []int
	commands []actionsapi.Command
	names    []string // the quick switcher's titles: display paths, .md dropped
	paths    []string
	recent   bool // results are the recent files (empty query)
}

func (ws *Workspace) openPalette(mode paletteMode) {
	if ws.palette != nil && ws.palette.mode == mode {
		ws.palette = nil // the same shortcut toggles it
		return
	}
	p := &palette{mode: mode, ranked: "\x00"}
	switch mode {
	case modeCommands:
		p.commands = ws.paletteCommands()
	case modeFiles:
		ws.useListing(p)
		ws.refreshFiles()
	}
	ws.palette = p
}

// useListing fills the palette's candidates from the last listing.
func (ws *Workspace) useListing(p *palette) {
	if ws.files == nil {
		return
	}
	byID := map[string]projectcontract.Mount{}
	for _, m := range ws.mounts {
		byID[m.ID] = m
	}
	// QuickSwitcher.getItems: every file, sorted by path naturally, its
	// text the path without ".md" (getQuickSwitcherFileTitle). The reader
	// shows every file type (attention's showAllFileTypes).
	type item struct{ title, path string }
	items := make([]item, 0, len(ws.files.Files))
	for _, f := range ws.files.Files {
		m, ok := byID[f.Mount]
		if !ok {
			continue
		}
		items = append(items, item{switcherTitle(projectcontract.Display(m, f.Rel)), f.Path})
	}
	sort.SliceStable(items, func(i, j int) bool { return natural.Less(items[i].title, items[j].title) })
	p.names, p.paths = p.names[:0], p.paths[:0]
	for _, it := range items {
		p.names = append(p.names, it.title)
		p.paths = append(p.paths, it.path)
	}
	p.ranked = "\x00"
}

// switcherTitle is getQuickSwitcherFileTitle: a Markdown file without its
// extension.
func switcherTitle(display string) string {
	if strings.EqualFold(filepath.Ext(display), ".md") {
		return display[:len(display)-3]
	}
	return display
}

// paletteCommands is CommandPalette.getCommands: by name naturally, the
// recently run ones first, most recent first.
func (ws *Workspace) paletteCommands() []actionsapi.Command {
	var cmds []actionsapi.Command
	for _, c := range actionsapi.List() {
		if c.Title != "" {
			cmds = append(cmds, c)
		}
	}
	sort.SliceStable(cmds, func(i, j int) bool { return natural.Less(cmds[i].Title, cmds[j].Title) })
	order := map[string]int{}
	for i, id := range ws.recentCommands {
		order[id] = i + 1
	}
	rank := func(c actionsapi.Command) int {
		if n, ok := order[c.ID]; ok {
			return n
		}
		return len(order) + 1
	}
	sort.SliceStable(cmds, func(i, j int) bool { return rank(cmds[i]) < rank(cmds[j]) })
	return cmds
}

// noteRecentCommand is CommandPalette.recordRecent.
func (ws *Workspace) noteRecentCommand(id string) {
	out := []string{id}
	for _, r := range ws.recentCommands {
		if r != id {
			out = append(out, r)
		}
	}
	if len(out) > maxRecentCommands {
		out = out[:maxRecentCommands]
	}
	ws.recentCommands = out
	ws.changed()
}

// noteRecentFile keeps the quick switcher's recent files, newest first.
func (ws *Workspace) noteRecentFile(path string) {
	out := []string{path}
	for _, r := range ws.recentFiles {
		if r != path {
			out = append(out, r)
		}
	}
	if len(out) > maxRecentFiles {
		out = out[:maxRecentFiles]
	}
	ws.recentFiles = out
}

// refreshFiles walks the mounts again on a goroutine; the palette shows the
// last listing meanwhile.
func (ws *Workspace) refreshFiles() {
	if ws.filesBusy {
		return
	}
	ws.filesBusy = true
	go func() {
		listing, err := ws.project.Files(ws.ctx)
		shellapi.Update(func() {
			ws.filesBusy = false
			if err != nil {
				return
			}
			ws.files = &listing
			if ws.palette != nil && ws.palette.mode == modeFiles {
				ws.useListing(ws.palette)
			}
		})
	}()
}

// rerank recomputes the results when the query changed.
func (ws *Workspace) rerank(p *palette) {
	if p.ranked == p.query {
		return
	}
	p.ranked = p.query
	p.selected = 0
	p.recent = false
	q := strings.TrimSpace(p.query)
	indices := func(rs []fuzzy.Ranked) []int {
		out := make([]int, len(rs))
		for i, r := range rs {
			out[i] = r.Index
		}
		return out
	}
	switch p.mode {
	case modeFiles:
		if q == "" {
			// QuickSwitcherModal.getSuggestions: no query shows the recent files.
			p.recent = true
			p.results = p.results[:0]
			for _, path := range ws.recentFiles {
				for i, candidate := range p.paths {
					if candidate == path {
						p.results = append(p.results, i)
						break
					}
				}
			}
			return
		}
		p.results = indices(fuzzy.Rank(q, len(p.names), func(i int) string { return p.names[i] }, maxResults))
	case modeCommands:
		p.results = indices(fuzzy.Rank(q, len(p.commands), func(i int) string { return p.commands[i].Title }, maxResults))
	case modeLine:
		p.results = nil
	}
}

// accept chooses the selected row; newTab is QuickSwitcher.choose's Mod
// click or Mod+Enter.
func (ws *Workspace) accept(p *palette, newTab bool) {
	switch p.mode {
	case modeFiles:
		if p.selected < len(p.results) {
			ws.palette = nil
			ws.openIn(p.paths[p.results[p.selected]], nil, newTab)
		}
	case modeCommands:
		if p.selected < len(p.results) {
			cmd := p.commands[p.results[p.selected]]
			ws.palette = nil
			ws.noteRecentCommand(cmd.ID)
			// Commands hop to the main thread themselves; run off it.
			go func() { _, _ = cmd.Run(ws.ctx, actionsapi.Args{Params: map[string]string{}}) }()
		}
	case modeLine:
		line, col, ok := parseLineCol(p.query)
		t := ws.activeTab()
		if !ok || t == nil || t.ed == nil {
			return
		}
		ws.palette = nil
		t.ed.GoTo(editor.Pos{Line: min(line, t.ed.Buffer.LineCount()) - 1, Col: max(0, col-1)})
	}
}

// parseLineCol reads "12" or "12:5".
func parseLineCol(s string) (line, col int, ok bool) {
	s = strings.TrimSpace(s)
	l, c, _ := strings.Cut(s, ":")
	line, err := strconv.Atoi(l)
	if err != nil || line < 1 {
		return 0, 0, false
	}
	col = 1
	if c != "" {
		if col, err = strconv.Atoi(c); err != nil || col < 1 {
			return 0, 0, false
		}
	}
	return line, col, true
}

func (ws *Workspace) paletteView(c *ui.Context) {
	p := ws.palette
	t := c.Theme()
	if c.Shortcut(0, ui.KeyEscape) {
		ws.palette = nil
		return
	}
	ws.rerank(p)
	if c.Shortcut(0, ui.KeyDown) && p.selected+1 < len(p.results) {
		p.selected++
	}
	if c.Shortcut(0, ui.KeyUp) && p.selected > 0 {
		p.selected--
	}
	if c.Shortcut(ui.Cmd, ui.KeyEnter) {
		ws.accept(p, true)
		return
	}

	placeholder := map[paletteMode]string{
		modeFiles:    "Search files…",
		modeCommands: "Execute a command…",
		modeLine:     "Go to line (line or line:column)…",
	}[p.mode]

	// A full-window layer: a click outside the panel closes it.
	layer := ui.Column(c).Absolute().Top(0).Left(0).Right(0).Bottom(0).AlignItems(ui.Center)
	if layer.Clicked() {
		ws.palette = nil
	}
	layer.Children(func() {
		panel := ui.Column(c).Key("palette").MarginY(64).Width(600).MaxHeight(440).
			Background(t.Background).Radius(10).BorderWidth(1).BorderColor(t.Border).Padding(6).Gap(4)
		panel.Children(func() {
			field := omgui.Field(c, &p.query, placeholder, false).AutoFocus().FillWidth()
			if field.Submitted() {
				ws.accept(p, false)
				return
			}
			switch p.mode {
			case modeLine:
				hint := "Type a line number"
				if tb := ws.activeTab(); tb == nil || tb.ed == nil {
					hint = "No text file is active"
				} else {
					pos := tb.ed.CursorPos()
					hint = "Current line " + strconv.Itoa(pos.Line+1) + " of " + strconv.Itoa(tb.ed.Buffer.LineCount())
				}
				ui.Text(c, hint).TextColor(t.TextMuted).FontSize(12).Padding(6, 8)
			default:
				ws.paletteRows(c, p)
			}
		})
	})
}

func (ws *Workspace) paletteRows(c *ui.Context, p *palette) {
	t := c.Theme()
	if len(p.results) == 0 {
		msg := "No matches"
		switch {
		case p.mode == modeFiles && ws.files == nil:
			msg = "Listing files…"
		case p.recent:
			msg = "No recent files"
		}
		ui.Text(c, msg).TextColor(t.TextMuted).FontSize(12).Padding(6, 8)
		return
	}
	ui.List(c, nil, len(p.results), func(i int) {
		idx := p.results[i]
		switch p.mode {
		case modeFiles:
			name := p.names[idx]
			base, dir := name, ""
			if k := strings.LastIndexByte(name, '/'); k >= 0 {
				base, dir = name[k+1:], name[:k]
			}
			omgui.CommandRow(c, omgui.CommandRowProps{
				Key: "f:" + p.paths[idx], Label: base, Detail: dir, Icon: fileIcon(base),
				Selected: i == p.selected,
				OnClick:  func() { p.selected = i; ws.accept(p, false) },
			})
		case modeCommands:
			cmd := p.commands[idx]
			keys := cmd.Keys
			omgui.CommandRow(c, omgui.CommandRowProps{
				Key: "c:" + cmd.ID, Label: cmd.Title, Selected: i == p.selected,
				Trailing: func(c *ui.Context) {
					if keys != "" {
						ui.Text(c, keys).FontSize(12).TextColor(c.Theme().TextMuted)
					}
				},
				OnClick: func() { p.selected = i; ws.accept(p, false) },
			})
		}
	}).MaxHeight(380).FillWidth()
	if p.mode == modeFiles && ws.files != nil && ws.files.Truncated {
		ui.Text(c, "Listing stopped at its limit; narrow the mounts for a complete list.").
			TextColor(t.TextMuted).FontSize(11).Padding(4, 8)
	}
}

// fileIcon picks a lucide icon for a file name.
func fileIcon(name string) *ui.SVG { return fileicon.For(name) }
