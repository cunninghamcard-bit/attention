// Package search is the search UI plugin: the left dock's Search panel, a
// port of attention's global search view (apps/web/builtin/SearchView.ts)
// over the project service's search, and the CLI's search, search:context
// and search:open (apps/web/app/cli/commands/searchCli.ts).
//
// Left out for now: the operator suggestions under the field and "More
// context" (the engine returns the matched line only).
package search

import (
	"context"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/cunninghamcard-bit/acard-ui/components/button"
	"github.com/cunninghamcard-bit/acard-ui/components/selectmenu"
	"github.com/cunninghamcard-bit/acard-ui/components/toggleswitch"
	"github.com/cunninghamcard-bit/acard-ui/components/tooltip"
	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/natural"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/appearance"
	"github.com/cunninghamcard-bit/attention/native/plugins/layout"
	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
	auiicon "github.com/cunninghamcard-bit/attention/native/ui/icon"
)

const (
	// PanelID is the Search panel's slot id.
	PanelID = "search"

	// debounce is the wait after a keystroke before searching; attention
	// searches on every change, which the disk walk here cannot keep up with.
	debounce = 250 * time.Millisecond

	// resultLimit stops a search after this many files.
	resultLimit = 2000
)

var (
	// sortOrders are SearchView's, less the created-time pair (Linux keeps no
	// creation time that fs reports).
	sortOrders = []selectmenu.SelectOption{
		{Value: "alphabetical", Label: "A to Z"},
		{Value: "alphabeticalReverse", Label: "Z to A"},
		{Value: "byModifiedTime", Label: "Modified time (new to old)"},
		{Value: "byModifiedTimeReverse", Label: "Modified time (old to new)"},
	}

	// Plugin registers the Search panel while loaded.
	Plugin = rutis.Define(rutis.Plugin[struct{}]{
		Name:   "search",
		Inject: []string{"shell", "slots", "layout", "workspace", "project", "actions", "appearance"},
		Apply: func(rctx *rutis.Ctx, _ struct{}) error {
			var (
				sh      *shell.Shell
				sl      *slots.Registry
				lyt     *layout.Layout
				ws      *workspace.Workspace
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
			s := &Search{app: app, ctx: ctx, sh: sh, lyt: lyt, ws: ws, project: project, sortOrder: "alphabetical", collapsed: map[string]bool{}}
			off := sl.RegisterPanel(slots.Panel{
				ID: PanelID, Title: "Search", Icon: icon.Search.SVG(), Dock: slots.Sidebar, Order: 1,
				View: s.view, State: s.state, Restore: s.restore,
			})
			offs := []func(){off}
			for _, cmd := range s.commands() {
				offs = append(offs, act.Add(cmd))
			}
			rctx.Effect(func(context.Context) error {
				for i := len(offs) - 1; i >= 0; i-- {
					offs[i]()
				}
				cancel()
				return nil
			})
			return nil
		},
	})
)

// Workspace is the file opening and path display the search panel uses.
type Workspace interface {
	Open(path string, nav *workspace.Nav, newTab bool)
	Display(path string) string
}

// Search is the panel's state, on the main thread only.
type Search struct {
	app     *appearance.Appearance
	ctx     context.Context
	sh      *shell.Shell
	lyt     *layout.Layout
	ws      Workspace
	project projectplugin.Project

	query         string
	matchingCase  bool
	showParams    bool
	collapseAll   bool
	explainSearch bool
	sortOrder     string

	typed   string // the query as last seen, to notice typing
	timer   *time.Timer
	seq     int
	cancel  context.CancelFunc
	loading bool
	err     string
	ran     string // the query the results are for
	results []projectplugin.FileResult
	limited bool

	collapsed map[string]bool // per file, flipped from collapseAll
	rows      []row
	dirty     bool
	revealed  int
}

func (s *Search) state() json.RawMessage {
	data, _ := json.Marshal(savedState{Query: s.query, MatchingCase: s.matchingCase, ExplainSearch: s.explainSearch,
		CollapseAll: s.collapseAll, SortOrder: s.sortOrder})
	return data
}

// restore is SearchView.setState: it searches again.
func (s *Search) restore(data json.RawMessage) {
	var st savedState
	if json.Unmarshal(data, &st) != nil {
		return
	}
	s.query, s.typed = st.Query, st.Query
	s.matchingCase, s.explainSearch, s.collapseAll = st.MatchingCase, st.ExplainSearch, st.CollapseAll
	for _, o := range sortOrders {
		if o.Value == st.SortOrder {
			s.sortOrder = st.SortOrder
		}
	}
	s.start()
}

// setQuery is SearchView.setQuery: the field shows query and a search runs.
func (s *Search) setQuery(query string) {
	s.query, s.typed = query, query
	s.start()
}

// changed starts the debounce after the query changed. A search still
// running is for the old text: the seq moves on so its result is dropped,
// as SearchView drops a stale searchId. An emptied field clears at once.
func (s *Search) changed() {
	if s.timer != nil {
		s.timer.Stop()
	}
	if strings.TrimSpace(s.query) == "" {
		s.start()
		return
	}
	s.seq++
	seq := s.seq
	s.timer = time.AfterFunc(debounce, func() {
		if s.sh != nil {
			s.sh.Update(func() {
				if seq == s.seq {
					s.start()
				}
			})
		}
	})
}

// start is SearchView.startSearch: an empty query clears the results.
func (s *Search) start() {
	if s.timer != nil {
		s.timer.Stop()
	}
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	s.seq++
	seq := s.seq
	s.results, s.err, s.limited, s.loading, s.dirty = nil, "", false, false, true
	q := strings.TrimSpace(s.query)
	s.ran = q
	if q == "" || s.ctx.Err() != nil {
		return // nothing to search, or unloaded (a debounce fired late)
	}
	ctx, cancel := context.WithCancel(s.ctx)
	s.cancel = cancel
	s.loading = true
	query := projectplugin.Query{Text: q, CaseSensitive: s.matchingCase, Limit: resultLimit}
	go func() {
		res, err := s.project.Search(ctx, query)
		if s.sh == nil {
			return
		}
		s.sh.Update(func() {
			if seq != s.seq {
				return // a newer search replaced this one
			}
			s.loading, s.cancel = false, nil
			cancel()
			if err != nil {
				if ctx.Err() == nil {
					s.err = err.Error()
				}
				return
			}
			s.results, s.limited = res.Files, res.Truncated
			s.collapsed = map[string]bool{}
			s.sort()
		})
	}()
}

// sort is SearchView.sortResults: by base name, ties by path.
func (s *Search) sort() {
	base := func(f projectplugin.FileResult) string {
		name := path.Base(f.Rel)
		return strings.ToLower(strings.TrimSuffix(name, path.Ext(name)))
	}
	byPath := func(a, b projectplugin.FileResult) bool {
		return natural.Less(strings.ToLower(a.Path), strings.ToLower(b.Path))
	}
	sort.SliceStable(s.results, func(i, j int) bool {
		a, b := s.results[i], s.results[j]
		switch s.sortOrder {
		case "alphabeticalReverse":
			if base(a) != base(b) {
				return natural.Less(base(b), base(a))
			}
			return byPath(b, a)
		case "byModifiedTime":
			if a.ModTime != b.ModTime {
				return a.ModTime > b.ModTime
			}
		case "byModifiedTimeReverse":
			if a.ModTime != b.ModTime {
				return a.ModTime < b.ModTime
			}
		default:
			if base(a) != base(b) {
				return natural.Less(base(a), base(b))
			}
		}
		return byPath(a, b)
	})
	s.dirty = true
}

func (s *Search) isCollapsed(f *projectplugin.FileResult) bool {
	return s.collapseAll != s.collapsed[f.Path]
}

func (s *Search) flatten() []row {
	if !s.dirty {
		return s.rows
	}
	s.rows = s.rows[:0]
	for i := range s.results {
		f := &s.results[i]
		s.rows = append(s.rows, row{file: f, match: -1})
		if s.isCollapsed(f) {
			continue
		}
		for m := range f.Matches {
			s.rows = append(s.rows, row{file: f, match: m})
		}
	}
	s.dirty = false
	return s.rows
}

func (s *Search) view(c *ui.Context, p slots.PanelProps) {
	t := c.Theme()
	ui.Column(c).Fill().Children(func() {
		ui.Row(c).Padding(8, 8, 4, 8).Gap(4).AlignItems(ui.Center).Children(func() {
			ui.Box(c).Grow(1).Children(func() {
				field := aui.SearchField(c, &s.query, "Search...", false)
				field.Label("Search")
				if p.Reveal != s.revealed {
					s.revealed = p.Reveal
					field.Focus()
				}
				if field.Submitted() {
					s.start()
				} else if s.query != s.typed {
					s.typed = s.query
					s.changed()
				}
			})
			if toggleIcon(c, auiicon.Must("case-sensitive"), "Match case", s.matchingCase) {
				s.matchingCase = !s.matchingCase
				if strings.TrimSpace(s.query) != "" {
					s.start()
				}
			}
			if toggleIcon(c, auiicon.Must("sliders-horizontal"), "Toggle search settings", s.showParams) {
				s.showParams = !s.showParams
			}
		})
		if s.showParams {
			ui.Column(c).Children(func() {
				setting(c, "Collapse results", &s.collapseAll, func() {
					s.collapsed = map[string]bool{}
					s.dirty = true
				})
				setting(c, "Explain search term", &s.explainSearch, nil)
			})
		}
		if s.explainSearch && s.ran != "" {
			ui.Text(c, "Search: "+s.ran).FontSize(12).TextColor(t.TextMuted).Padding(2, 12)
		}
		if s.err != "" {
			ui.Text(c, s.err).FontSize(12).TextColor(t.Danger).Padding(4, 12)
		}
		if s.ran == "" {
			return
		}
		ui.Row(c).Padding(4, 12).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Text(c, s.countText()).FontSize(12).TextColor(t.TextMuted).Grow(1).MinWidth(0).SingleLine().Ellipsis("…")
			if selectmenu.Select(c.Key("search-sort"), &s.sortOrder, selectmenu.SelectProps{Options: sortOrders}).
				Label("Sort order").Width(120).Changed() {
				s.sort()
			}
		})
		if !s.loading && s.err == "" && len(s.results) == 0 {
			ui.Text(c, "No matches found").TextColor(t.TextMuted).Padding(12)
			return
		}
		rows := s.flatten()
		ui.List(c, nil, len(rows), func(i int) {
			r := rows[i]
			f := r.file
			if r.match < 0 {
				s.fileRow(c, f)
				return
			}
			m := &f.Matches[r.match]
			item := aui.SideRow(c, aui.SideRowProps{Key: fmt.Sprintf("m:%s:%d", f.Path, r.match), Depth: 2})
			if item.Clicked() {
				s.open(f, m)
			}
			item.Children(func() {
				highlighted(c, m)
			})
		}).Grow(1).FillWidth().PaddingY(4)
	})
}

// countText is SearchView.renderResults' count: a file that only passed
// the filters counts one result.
func (s *Search) countText() string {
	if s.loading {
		return "Searching…"
	}
	n := 0
	for _, f := range s.results {
		n += max(1, len(f.Matches))
	}
	out := fmt.Sprintf("%d result%s in %d file%s", n, plural(n), len(s.results), plural(len(s.results)))
	if s.limited {
		out += " (limited)"
	}
	return out
}

func (s *Search) fileRow(c *ui.Context, f *projectplugin.FileResult) {
	t := c.Theme()
	name := f.Path
	if s.ws != nil {
		name = s.ws.Display(f.Path)
	}
	item := aui.SideRow(c, aui.SideRowProps{Key: "f:" + f.Path, Depth: 0})
	if item.Clicked() {
		var first *projectplugin.Match
		if len(f.Matches) > 0 {
			first = &f.Matches[0]
		}
		s.open(f, first)
	}
	tooltip.Tooltip(c, item, tooltip.TooltipProps{Text: name})
	item.Children(func() {
		if len(f.Matches) > 0 {
			if aui.Disclosure(c, !s.isCollapsed(f), 14).Clicked() {
				s.collapsed[f.Path] = !s.collapsed[f.Path]
				s.dirty = true
			}
		} else {
			ui.Box(c).Width(14).Shrink(0)
		}
		s.app.Icons().Render(c, f.Rel, false, false, t.Dark, 15)
		ui.Text(c, name).FontSize(13).SingleLine().Ellipsis("…").Shrink(1)
		if len(f.Matches) > 0 {
			ui.Text(c, strconv.Itoa(len(f.Matches))).FontSize(11).TextColor(t.TextMuted).Shrink(0)
		}
	})
}

// open is SearchView.openResult: the match is selected in the file.
func (s *Search) open(f *projectplugin.FileResult, m *projectplugin.Match) {
	if s.ws == nil {
		return
	}
	var nav *workspace.Nav
	if m != nil {
		nav = &workspace.Nav{Line: m.Line, Col: m.Col, Len: m.Len}
	}
	s.ws.Open(f.Path, nav, false)
}

// row is a file title or one of its matches.
type row struct {
	file  *projectplugin.FileResult
	match int // -1 on the file's title
}

// savedState is SearchView.getState's, less "More context".
type savedState struct {
	Query         string `json:"query"`
	MatchingCase  bool   `json:"matchingCase"`
	ExplainSearch bool   `json:"explainSearch"`
	CollapseAll   bool   `json:"collapseAll"`
	SortOrder     string `json:"sortOrder"`
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// highlighted is a match as "line: text" with the matched part marked
// (SearchView.renderMatch).
func highlighted(c *ui.Context, m *projectplugin.Match) {
	t := c.Theme()
	text := m.Text
	from := min(max(0, m.Col-1), len(text))
	to := min(from+m.Len, len(text))
	spans := []ui.Span{{Text: strconv.Itoa(m.Line) + ": ", Color: t.TextMuted}}
	if from > 0 {
		spans = append(spans, ui.Span{Text: text[:from]})
	}
	spans = append(spans, ui.Span{Text: text[from:to], Background: t.Selection})
	if to < len(text) {
		spans = append(spans, ui.Span{Text: text[to:]})
	}
	ui.RichText(c, spans...).FontSize(12).Font(appearance.MonoFont).SingleLine().Ellipsis("…").Shrink(1)
}

// toggleIcon is a clickable-icon with is-active: a ghost icon button in
// the accent colour while on.
func toggleIcon(c *ui.Context, glyph *ui.SVG, tip string, on bool) bool {
	b := button.Button(c, button.ButtonProps{Label: tip, Variant: button.ButtonGhost, Size: button.ButtonSm, Children: func() {
		ic := ui.Icon(c, glyph).Size(14, 14)
		if on {
			ic.TextColor(c.Theme().Accent)
		}
	}}).Width(28).PaddingX(0).Checked(on)
	tooltip.Tooltip(c, b, tooltip.TooltipProps{Text: tip})
	return b.Clicked()
}

func setting(c *ui.Context, label string, on *bool, changed func()) {
	if toggleswitch.Switch(c, on, toggleswitch.SwitchProps{Label: label}).PaddingX(8).Changed() && changed != nil {
		changed()
	}
}
