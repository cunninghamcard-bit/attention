package fuzzy

import (
	"reflect"
	"testing"
)

// The expectations of tests/web/plugin/PluginApiParity.test.ts ("exports
// search helper functions for fuzzy/simple matching, sorting …").

func TestPrepare(t *testing.T) {
	got := Prepare("qs")
	want := Query{Query: "qs", Tokens: []string{"qs"}, Fuzzy: []string{"q", "s"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Prepare(qs) = %+v, want %+v", got, want)
	}
}

func TestSearchFuzzy(t *testing.T) {
	r := Search(Prepare("qs"), "Quick Switcher")
	if r == nil || !reflect.DeepEqual(r.Matches, []Match{{0, 1}, {6, 7}}) {
		t.Fatalf("qs in Quick Switcher = %+v", r)
	}
	if r := Search(Prepare("qs"), "Command Palette"); r != nil {
		t.Fatalf("qs in Command Palette = %+v, want no match", r)
	}
}

func TestSimple(t *testing.T) {
	simple := PrepareSimple("quick switch")
	r := simple("Open Quick Switcher")
	if r == nil || !reflect.DeepEqual(r.Matches, []Match{{5, 10}, {11, 17}}) {
		t.Fatalf("simple = %+v", r)
	}
	if simple("Open Quick Panel") != nil {
		t.Fatal("Open Quick Panel matched")
	}
}

func TestRankSortsByScore(t *testing.T) {
	items := []string{"plugins/workspace/view.go", "docs/rfc/0001-spike-report.md", "plugins/workspace/viewer.go"}
	got := Rank("view", len(items), func(i int) string { return items[i] }, 0)
	if len(got) != 2 || items[got[0].Index] != "plugins/workspace/view.go" {
		t.Fatalf("Rank(view) = %+v", got)
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].Result.Score < got[i].Result.Score {
			t.Fatal("not sorted by score")
		}
	}
}
