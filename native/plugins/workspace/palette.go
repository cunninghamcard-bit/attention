package workspace

import (
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

type paletteMode int

const (
	modeFiles paletteMode = iota
	modeCommands
	modeLine
)

// maxResults is how many rows the palette shows.
const maxResults = 60

type palette struct {
	mode     paletteMode
	query    string
	ranked   string // the query results were ranked for
	selected int
	results  []int
	commands []actionsapi.Command
	names    []string // the file listing's display names
	paths    []string
}

func (ws *Workspace) openPalette(mode paletteMode) {
	if ws.palette != nil && ws.palette.mode == mode {
		ws.palette = nil // the same shortcut toggles it
		return
	}
	p := &palette{mode: mode, ranked: "\x00"}
	switch mode {
	case modeCommands:
		for _, c := range actionsapi.List() {
			if c.Title != "" {
				p.commands = append(p.commands, c)
			}
		}
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
	p.names = p.names[:0]
	p.paths = p.paths[:0]
	for _, f := range ws.files.Files {
		m, ok := byID[f.Mount]
		if !ok {
			continue
		}
		p.names = append(p.names, projectcontract.Display(m, f.Rel))
		p.paths = append(p.paths, f.Path)
	}
	p.ranked = "\x00"
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
	q := strings.TrimSpace(p.query)
	switch p.mode {
	case modeFiles:
		p.results = rank(q, len(p.names), func(i int) string { return p.names[i] }, maxResults)
	case modeCommands:
		p.results = rank(q, len(p.commands), func(i int) string { return p.commands[i].Title }, maxResults)
	case modeLine:
		p.results = nil
	}
}

func (ws *Workspace) accept(p *palette) {
	switch p.mode {
	case modeFiles:
		if p.selected < len(p.results) {
			ws.palette = nil
			ws.open(p.paths[p.results[p.selected]], nil)
		}
	case modeCommands:
		if p.selected < len(p.results) {
			cmd := p.commands[p.results[p.selected]]
			ws.palette = nil
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
				ws.accept(p)
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
		if p.mode == modeFiles && ws.files == nil {
			msg = "Listing files…"
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
				OnClick:  func() { p.selected = i; ws.accept(p) },
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
				OnClick: func() { p.selected = i; ws.accept(p) },
			})
		}
	}).MaxHeight(380).FillWidth()
	if p.mode == modeFiles && ws.files != nil && ws.files.Truncated {
		ui.Text(c, "Listing stopped at its limit; narrow the mounts for a complete list.").
			TextColor(t.TextMuted).FontSize(11).Padding(4, 8)
	}
}

// fileIcon picks a lucide icon for a file name.
func fileIcon(name string) *ui.SVG {
	switch kindFor(name) {
	case kindMarkdown:
		return lucide.FileText()
	case kindImage:
		return lucide.Image()
	}
	return lucide.File()
}
