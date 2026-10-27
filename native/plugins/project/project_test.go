package project

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/arcships/rutis/go/rutis/rutistest"

	contract "github.com/cunninghamcard-bit/attention/native/contract/project"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
)

func TestConfigMountsAddAndRemove(t *testing.T) {
	root := t.TempDir()
	extra := t.TempDir()
	loaded := loadProject(t, root)

	var mounts []contract.Mount
	call(t, loaded, "mounts", &mounts)
	if len(mounts) != 1 || mounts[0].Path != root {
		t.Fatalf("config mounts = %+v, want %s", mounts, root)
	}

	var added contract.Mount
	call(t, loaded, "addMount", &added, extra)
	if added.Path != extra {
		t.Fatalf("addMount = %+v", added)
	}
	call(t, loaded, "mounts", &mounts)
	if len(mounts) != 2 {
		t.Fatalf("after add: %+v", mounts)
	}

	call(t, loaded, "removeMount", nil, added.ID)
	call(t, loaded, "mounts", &mounts)
	if len(mounts) != 1 || mounts[0].Path != root {
		t.Fatalf("after remove: %+v", mounts)
	}
}

func TestFilesSkipsNodeModulesAndGit(t *testing.T) {
	root := t.TempDir()
	write := func(rel, body string) {
		t.Helper()
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("keep.md", "keep")
	write("nested/ok.md", "ok")
	write("node_modules/pkg/index.js", "skip")
	write(".git/config", "skip")

	loaded := loadProject(t, root)
	var listing contract.Listing
	call(t, loaded, "files", &listing)

	var rels []string
	for _, f := range listing.Files {
		rels = append(rels, f.Rel)
	}
	if listing.Truncated {
		t.Fatalf("truncated: %+v", listing)
	}
	if len(rels) != 2 {
		t.Fatalf("files = %v", rels)
	}
	seen := map[string]bool{}
	for _, r := range rels {
		seen[r] = true
	}
	if !seen["keep.md"] || !seen["nested/ok.md"] {
		t.Fatalf("files = %v", rels)
	}
}

// The service runs the SearchEngine.ts port (its own tests are in
// searchengine_test.go): this covers the call through rutis.
func TestSearchCaseLimitFiltersAndMultipleMatches(t *testing.T) {
	root := t.TempDir()
	write := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("dup.md", "abc abc\n")
	write("case.md", "Foo foo FOO\n")
	write("x1.md", "x\n")
	write("x2.md", "x\n")
	write("x3.md", "x\n")

	loaded := loadProject(t, root)
	search := func(q contract.Query) contract.SearchResult {
		t.Helper()
		var res contract.SearchResult
		call(t, loaded, "search", &res, q)
		return res
	}
	matches := func(res contract.SearchResult) int {
		n := 0
		for _, f := range res.Files {
			n += len(f.Matches)
		}
		return n
	}

	if res := search(contract.Query{Text: "foo"}); len(res.Files) != 1 || matches(res) != 3 {
		t.Fatalf("case-insensitive foo = %+v", res)
	}
	if res := search(contract.Query{Text: "Foo", CaseSensitive: true}); matches(res) != 1 || res.Files[0].Matches[0].Col != 1 {
		t.Fatalf("case-sensitive Foo = %+v", res)
	}
	if res := search(contract.Query{Text: "x", Limit: 2}); len(res.Files) != 2 || !res.Truncated {
		t.Fatalf("limit 2 = %+v", res)
	}
	if res := search(contract.Query{Text: "file:case"}); len(res.Files) != 1 || res.Files[0].Rel != "case.md" || res.Files[0].ModTime == 0 {
		t.Fatalf("file:case = %+v", res)
	}

	multi := search(contract.Query{Text: "abc"})
	if len(multi.Files) != 1 || matches(multi) != 2 {
		t.Fatalf("two matches on one line = %+v", multi)
	}
	ms := multi.Files[0].Matches
	if ms[0].Line != 1 || ms[1].Line != 1 || ms[0].Col == ms[1].Col {
		t.Fatalf("want both on line 1 at distinct columns: %+v", ms)
	}
	for _, m := range ms {
		if !strings.Contains(m.Text, "abc abc") {
			t.Fatalf("line text = %q", m.Text)
		}
	}
}

// stub is a stand-in for the injected "actions" service.
type stub struct{}

func (stub) Ready(context.Context) error { return nil }

func loadProject(t *testing.T, mounts ...string) *rutistest.Loaded {
	t.Helper()
	t.Setenv("ATTENTION_CONFIG_DIR", t.TempDir())
	fs, err := fsplugin.New(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = fs.Close() })
	return rutistest.Load(t, Plugin, Config{Mounts: mounts}, map[string]any{
		"actions": stub{},
		"fs":      fs,
	})
}

func call(t *testing.T, loaded *rutistest.Loaded, method string, result any, args ...any) {
	t.Helper()
	if err := loaded.Service("project").Call(t.Context(), method, result, args...); err != nil {
		t.Fatalf("%s: %v", method, err)
	}
}
