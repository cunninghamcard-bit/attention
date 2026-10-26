package workspace

import "testing"

func TestFuzzyScoreMatchesSubsequences(t *testing.T) {
	cases := []struct {
		q, c string
		ok   bool
	}{
		{"", "anything", true},
		{"wsp", "native/plugins/workspace/view.go", true},
		{"WSV", "plugins/workspace/view.go", true},
		{"zz", "plugins/workspace/view.go", false},
		{"view go", "plugins/workspace/view.go", true},
		{"view gx", "plugins/workspace/view.go", false},
	}
	for _, tc := range cases {
		if got := fuzzyScore(tc.q, tc.c) > 0; got != tc.ok {
			t.Errorf("fuzzyScore(%q, %q) matched=%v, want %v", tc.q, tc.c, got, tc.ok)
		}
	}
}

func TestRankPrefersBaseNameAndShortPaths(t *testing.T) {
	files := []string{
		"docs/rfc/0001-spike-report.md",
		"native/plugins/workspace/view.go",
		"native/plugins/workspace/viewer.go",
		"apps/web/views/workspace/WorkspaceTabs.ts",
	}
	got := rank("view", len(files), func(i int) string { return files[i] }, 10)
	if len(got) == 0 || files[got[0]] != "native/plugins/workspace/view.go" {
		t.Fatalf("rank(view) = %v, want view.go first", names(files, got))
	}
	got = rank("spike", len(files), func(i int) string { return files[i] }, 10)
	if len(got) != 1 || files[got[0]] != "docs/rfc/0001-spike-report.md" {
		t.Fatalf("rank(spike) = %v", names(files, got))
	}
}

func names(files []string, idx []int) []string {
	out := make([]string, len(idx))
	for i, j := range idx {
		out[i] = files[j]
	}
	return out
}
