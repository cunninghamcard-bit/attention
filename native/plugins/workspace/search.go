package workspace

import (
	"context"
	"fmt"
	"strconv"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention-ui/theme"
	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

type searchState struct {
	query         string
	regex         bool
	caseSensitive bool

	running bool
	seq     int
	cancel  context.CancelFunc
	result  *projectcontract.SearchResult
	err     string
	ran     string // the query the result is for
	rows    []searchRow
}

// searchRow is a file header or one match.
type searchRow struct {
	header bool
	match  projectcontract.Match
	name   string
	count  int
}

// openSearch focuses the active pane's search tab, or opens one.
func (ws *Workspace) openSearch() *tab {
	p := ws.activePane()
	for i, t := range p.tabs {
		if t.kind == kindSearch {
			p.active = i
			ws.changed()
			return t
		}
	}
	ws.nextTab++
	t := &tab{id: ws.nextTab, kind: kindSearch, title: "Search", search: &searchState{}}
	p.tabs = append(p.tabs, t)
	p.active = len(p.tabs) - 1
	ws.changed()
	return t
}

func (ws *Workspace) runSearch(s *searchState) {
	if s.cancel != nil {
		s.cancel()
	}
	if s.query == "" {
		s.result, s.rows, s.err, s.ran, s.running = nil, nil, "", "", false
		return
	}
	s.seq++
	seq := s.seq
	ctx, cancel := context.WithCancel(ws.ctx)
	s.cancel = cancel
	s.running = true
	q := projectcontract.Query{Text: s.query, Regex: s.regex, CaseSensitive: s.caseSensitive, Limit: 2000}
	go func() {
		res, err := ws.project.Search(ctx, q)
		shellapi.Update(func() {
			if seq != s.seq {
				return // a newer search replaced this one
			}
			s.running = false
			s.cancel = nil
			if err != nil {
				if ctx.Err() == nil {
					s.err = err.Error()
				}
				return
			}
			s.err = ""
			s.result = &res
			s.ran = q.Text
			s.rows = groupMatches(res.Matches, ws)
		})
	}()
}

func groupMatches(ms []projectcontract.Match, ws *Workspace) []searchRow {
	var rows []searchRow
	for i := 0; i < len(ms); {
		j := i
		for j < len(ms) && ms[j].Path == ms[i].Path {
			j++
		}
		rows = append(rows, searchRow{header: true, match: ms[i], name: ws.display(ms[i].Path), count: j - i})
		for _, m := range ms[i:j] {
			rows = append(rows, searchRow{match: m})
		}
		i = j
	}
	return rows
}

func (ws *Workspace) searchView(c *ui.Context, tb *tab) {
	s := tb.search
	t := c.Theme()
	ui.Column(c).Grow(1).FillWidth().Children(func() {
		ui.Row(c).Padding(8, 12).Gap(8).AlignItems(ui.Center).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
			field := omgui.Field(c, &s.query, "Search all files…", false).Grow(1).AutoFocus()
			if field.Submitted() {
				ws.runSearch(s)
			}
			if omgui.Chip(c, omgui.ChipProps{Label: "Aa", Selected: s.caseSensitive}).Clicked() {
				s.caseSensitive = !s.caseSensitive
				ws.runSearch(s)
			}
			if omgui.Chip(c, omgui.ChipProps{Label: ".*", Selected: s.regex}).Clicked() {
				s.regex = !s.regex
				ws.runSearch(s)
			}
		})
		status := ""
		switch {
		case s.running:
			status = "Searching…"
		case s.err != "":
			status = s.err
		case s.result != nil:
			files := map[string]bool{}
			for _, m := range s.result.Matches {
				files[m.Path] = true
			}
			status = fmt.Sprintf("%d results in %d files (%d files searched)", len(s.result.Matches), len(files), s.result.Files)
			if s.result.Truncated {
				status += " — limited"
			}
		default:
			status = "Press Enter to search"
		}
		ui.Text(c, status).FontSize(12).TextColor(t.TextMuted).Padding(6, 12)
		ui.List(c, nil, len(s.rows), func(i int) {
			r := s.rows[i]
			if r.header {
				ui.Row(c).Key("h:"+r.match.Path).Padding(8, 12, 2, 12).Gap(6).AlignItems(ui.Center).Children(func() {
					ui.Icon(c, fileIcon(r.name)).Size(14, 14).TextColor(t.TextMuted)
					ui.Text(c, r.name).Bold().FontSize(12)
					ui.Text(c, strconv.Itoa(r.count)).FontSize(11).TextColor(t.TextMuted)
				})
				return
			}
			m := r.match
			row := omgui.SideRow(c, omgui.SideRowProps{Key: fmt.Sprintf("m:%s:%d:%d", m.Path, m.Line, m.Col), Depth: 1})
			if row.Clicked() {
				ws.open(m.Path, &navTarget{line: m.Line})
			}
			row.Children(func() {
				ui.Text(c, strconv.Itoa(m.Line)).FontSize(12).TextColor(t.TextMuted).Width(44).Shrink(0)
				ui.Text(c, m.Text).FontSize(12).Font(theme.MonoFont).SingleLine().Ellipsis("…").Shrink(1)
			})
		}).Grow(1).FillWidth().Children(func() {
			if s.result != nil && len(s.rows) == 0 && !s.running {
				ui.Row(c).Padding(24).Gap(8).AlignItems(ui.Center).Children(func() {
					ui.Icon(c, lucide.SearchX()).Size(16, 16).TextColor(t.TextMuted)
					ui.Text(c, "No results for “"+s.ran+"”").TextColor(t.TextMuted)
				})
			}
		})
	})
}
