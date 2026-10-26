package project

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	contract "github.com/cunninghamcard-bit/attention/native/contract/project"
)

// The cases of tests/web/search/SearchEngine.test.ts over the same three
// files. tag:, [property] and section: need the metadata index (roadmap
// P2) and are skipped until it exists.

func fixture(t *testing.T) ([]contract.FileRef, func(contract.FileRef) string) {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"notes/alpha.md":  "---\nstatus: draft\ntags: [research]\n---\n\n# Intro\n\nneedle in the intro\n\n# Detail\n\nhay and needle together\n",
		"notes/beta.md":   "# Other\n\nonly hay here\nneedle on its own line\n#inline-tag\n",
		"agent/server.go": "package main\n// needle in code\n",
		"notes/link.md":   "see release:notes for details\n",
	}
	var refs []contract.FileRef
	for rel, body := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		refs = append(refs, contract.FileRef{Mount: "v", Rel: rel, Path: p})
	}
	return refs, func(f contract.FileRef) string { return f.Rel }
}

func searchPaths(t *testing.T, e *Engine, query string) []string {
	t.Helper()
	files, display := fixture(t)
	res, err := e.Search(t.Context(), files, display, contract.Query{Text: query})
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, r := range res {
		out = append(out, r.Rel)
	}
	return out
}

func TestPathNarrows(t *testing.T) {
	if got := searchPaths(t, NewEngine(nil), "path:agent needle"); !reflect.DeepEqual(got, []string{"agent/server.go"}) {
		t.Fatalf("got %v", got)
	}
}

func TestFileNarrowsWithoutKeywords(t *testing.T) {
	files, display := fixture(t)
	res, _ := NewEngine(nil).Search(t.Context(), files, display, contract.Query{Text: "file:beta"})
	if len(res) != 1 || res[0].Rel != "notes/beta.md" || len(res[0].Matches) != 0 {
		t.Fatalf("got %+v", res)
	}
}

func TestLineGroupNeedsOneLine(t *testing.T) {
	if got := searchPaths(t, NewEngine(nil), "line:(hay needle)"); !reflect.DeepEqual(got, []string{"notes/alpha.md"}) {
		t.Fatalf("got %v", got)
	}
}

func TestExtFilters(t *testing.T) {
	if got := searchPaths(t, NewEngine(nil), "ext:go needle"); !reflect.DeepEqual(got, []string{"agent/server.go"}) {
		t.Fatalf("got %v", got)
	}
}

func TestUnknownOperatorIsAKeyword(t *testing.T) {
	if got := searchPaths(t, NewEngine(nil), "release:notes"); !reflect.DeepEqual(got, []string{"notes/link.md"}) {
		t.Fatalf("got %v", got)
	}
}

func TestCustomOperators(t *testing.T) {
	e := NewEngine(nil)
	err := e.RegisterOperator(Operator{Name: "agent", Token: "agent:", Filter: func(f contract.FileRef, v string) bool {
		return strings.HasPrefix(f.Rel, v+"/")
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got := searchPaths(t, e, "agent:agent needle"); !reflect.DeepEqual(got, []string{"agent/server.go"}) {
		t.Fatalf("scoped: %v", got)
	}
	e.UnregisterOperator("agent")
	if got := searchPaths(t, e, "agent:agent"); len(got) != 0 {
		t.Fatalf("after unregister: %v", got)
	}
	if err := e.RegisterOperator(Operator{Name: "path"}); err == nil || !strings.Contains(err.Error(), "already registered") {
		t.Fatalf("registering path: %v", err)
	}
}

func TestPlainKeywordsSearchEveryTextFile(t *testing.T) {
	got := searchPaths(t, NewEngine(nil), "needle")
	want := []string{"agent/server.go", "notes/alpha.md", "notes/beta.md"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestMetadataOperatorsWaitForTheIndex(t *testing.T) {
	t.Skip("tag:, [property] and section: need the metadata index (roadmap P2)")
}
