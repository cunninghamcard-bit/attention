package project

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/arcships/rutis/go/rutis/rutistest"

	contract "github.com/cunninghamcard-bit/attention/native/contract/project"
)

// stub is a stand-in for the injected "actions" and "fs" services.
type stub struct{}

func (stub) Ready(context.Context) error { return nil }

func loadProject(t *testing.T, mounts ...string) *rutistest.Loaded {
	t.Helper()
	t.Setenv("ATTENTION_CONFIG_DIR", t.TempDir())
	return rutistest.Load(t, Plugin, Config{Mounts: mounts}, map[string]any{
		"actions": stub{},
		"fs":      stub{},
	})
}

func call(t *testing.T, loaded *rutistest.Loaded, method string, result any, args ...any) {
	t.Helper()
	if err := loaded.Service("project").Call(t.Context(), method, result, args...); err != nil {
		t.Fatalf("%s: %v", method, err)
	}
}

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

func TestSearchRegexCaseLimitAndMultipleMatches(t *testing.T) {
	root := t.TempDir()
	write := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("re.txt", "cat\ncot\ncut\n")
	write("dup.txt", "abc abc\n")
	write("case.txt", "Foo foo FOO\n")
	write("many.txt", "x\nx\nx\n")

	loaded := loadProject(t, root)

	var regex contract.SearchResult
	call(t, loaded, "search", &regex, contract.Query{Text: "c.t", Regex: true})
	if len(regex.Matches) != 3 {
		t.Fatalf("regex c.t = %+v", regex.Matches)
	}

	var literal contract.SearchResult
	call(t, loaded, "search", &literal, contract.Query{Text: "c.t"})
	if len(literal.Matches) != 0 {
		t.Fatalf("literal c.t = %+v", literal.Matches)
	}

	var insensitive contract.SearchResult
	call(t, loaded, "search", &insensitive, contract.Query{Text: "foo"})
	if len(insensitive.Matches) != 3 {
		t.Fatalf("case-insensitive foo = %+v", insensitive.Matches)
	}

	var sensitive contract.SearchResult
	call(t, loaded, "search", &sensitive, contract.Query{Text: "Foo", CaseSensitive: true})
	if len(sensitive.Matches) != 1 || sensitive.Matches[0].Col != 1 {
		t.Fatalf("case-sensitive Foo = %+v", sensitive.Matches)
	}

	var limited contract.SearchResult
	call(t, loaded, "search", &limited, contract.Query{Text: "x", Limit: 2})
	if len(limited.Matches) != 2 {
		t.Fatalf("limit 2 = %+v", limited.Matches)
	}

	var multi contract.SearchResult
	call(t, loaded, "search", &multi, contract.Query{Text: "abc"})
	if len(multi.Matches) != 2 {
		t.Fatalf("two matches on one line = %+v", multi.Matches)
	}
	if multi.Matches[0].Line != 1 || multi.Matches[1].Line != 1 {
		t.Fatalf("want both on line 1: %+v", multi.Matches)
	}
	if multi.Matches[0].Col == multi.Matches[1].Col {
		t.Fatalf("want distinct columns: %+v", multi.Matches)
	}
	for _, m := range multi.Matches {
		if !strings.Contains(m.Text, "abc abc") {
			t.Fatalf("line text = %q", m.Text)
		}
	}
}
