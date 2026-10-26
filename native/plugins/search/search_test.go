package search

import (
	"testing"

	"github.com/egoist/mygo/ui"

	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

type opened struct {
	path string
	nav  *workspaceapi.Nav
}

type fakeWorkspace struct{ opens []opened }

func (f *fakeWorkspace) Open(path string, nav *workspaceapi.Nav, _ bool) {
	f.opens = append(f.opens, opened{path, nav})
}
func (f *fakeWorkspace) ActivePath() string         { return "" }
func (f *fakeWorkspace) Display(path string) string { return "m" + path }
func (f *fakeWorkspace) RevealPanel(string)         {}

func results() []projectcontract.FileResult {
	return []projectcontract.FileResult{
		{Rel: "b/Note 10.md", Path: "/b/Note 10.md", ModTime: 1, Matches: []projectcontract.Match{{Line: 3, Col: 5, Len: 4, Text: "the word here"}}},
		{Rel: "a/note 2.md", Path: "/a/note 2.md", ModTime: 3},
		{Rel: "c/zeta.md", Path: "/c/zeta.md", ModTime: 2, Matches: []projectcontract.Match{{Line: 1, Col: 1, Len: 3, Text: "abc"}, {Line: 9, Col: 40, Len: 3, Text: "cut"}}},
	}
}

func names(s *Search) []string {
	var out []string
	for _, f := range s.results {
		out = append(out, f.Rel)
	}
	return out
}

func TestSortOrders(t *testing.T) {
	want := map[string][]string{
		"alphabetical":          {"a/note 2.md", "b/Note 10.md", "c/zeta.md"},
		"alphabeticalReverse":   {"c/zeta.md", "b/Note 10.md", "a/note 2.md"},
		"byModifiedTime":        {"a/note 2.md", "c/zeta.md", "b/Note 10.md"},
		"byModifiedTimeReverse": {"b/Note 10.md", "c/zeta.md", "a/note 2.md"},
	}
	for order, w := range want {
		s := &Search{sortOrder: order, results: results()}
		s.sort()
		if got := names(s); len(got) != 3 || got[0] != w[0] || got[1] != w[1] || got[2] != w[2] {
			t.Errorf("%s: %v, want %v", order, got, w)
		}
	}
}

func TestCountAndCollapse(t *testing.T) {
	s := &Search{sortOrder: "alphabetical", results: results(), collapsed: map[string]bool{}}
	s.sort()
	// A file that only passed the filters counts one result.
	if got := s.countText(); got != "4 results in 3 files" {
		t.Fatalf("count = %q", got)
	}
	if n := len(s.flatten()); n != 6 {
		t.Fatalf("rows = %d, want 3 files and 3 matches", n)
	}
	s.collapseAll, s.dirty = true, true
	if n := len(s.flatten()); n != 3 {
		t.Fatalf("collapsed rows = %d", n)
	}
	s.collapsed["/c/zeta.md"], s.dirty = true, true // flipped open again
	if n := len(s.flatten()); n != 5 {
		t.Fatalf("one expanded: rows = %d", n)
	}
}

func TestPanelOpensTheMatch(t *testing.T) {
	ws := &fakeWorkspace{}
	t.Cleanup(workspaceapi.Set(ws))
	s := &Search{sortOrder: "alphabetical", results: results(), collapsed: map[string]bool{}, ran: "word", query: "word", typed: "word"}
	s.sort()
	tt := ui.NewTester(func(c *ui.Context) { s.view(c, slotsapi.PanelProps{}) }, 400, 600)
	tt.Frame()
	if !tt.HasText("4 results in 3 files") {
		t.Fatalf("texts: %v", tt.Texts())
	}
	if err := tt.Click("m/b/Note 10.md"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if len(ws.opens) != 1 || ws.opens[0].path != "/b/Note 10.md" || ws.opens[0].nav == nil || ws.opens[0].nav.Line != 3 || ws.opens[0].nav.Col != 5 {
		t.Fatalf("a file row opens its first match: %+v", ws.opens)
	}
}
