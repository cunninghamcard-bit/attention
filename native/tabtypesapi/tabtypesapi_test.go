package tabtypesapi

import "testing"

func TestMatch(t *testing.T) {
	for _, c := range []struct {
		pattern, address string
		want             bool
	}{
		{"attention-resource://file/**", "attention-resource://file/mount/m/a/b.go", true},
		{"attention-resource://file/**", "attention-resource://git/r/a", false},
		{"attention-resource://file/mount/*/*.go", "attention-resource://file/mount/m/b.go", true},
		{"attention-resource://file/mount/*/*.go", "attention-resource://file/mount/m/a/b.go", false},
		{"*.md", "attention-resource://file/mount/m/notes/A.MD", true},
		{"*.md", "attention-resource://file/mount/m/a%20b.md", true},
		{"*.md", "attention-resource://file/mount/m/a.mdx", false},
		{"*.md", "not an address.md", false},
	} {
		if got := Match(c.pattern, c.address); got != c.want {
			t.Errorf("Match(%q, %q) = %v", c.pattern, c.address, got)
		}
	}
}

func TestClaimRanksByTierThenPatternThenOrder(t *testing.T) {
	const md = "attention-resource://file/mount/m/a.md"
	offs := []func(){
		Register(TabType{ID: "text", Kind: "text", Priority: Fallback, Patterns: []string{"attention-resource://file/**"}}),
		Register(TabType{ID: "md", Kind: "markdown", Priority: Builtin, Patterns: []string{"*.md"}}),
		Register(TabType{ID: "md-long", Kind: "markdown", Priority: Builtin, Patterns: []string{"attention-resource://file/**/*.md"}}),
		Register(TabType{ID: "veto", Kind: "markdown", Priority: Extension, Patterns: []string{"*.md"}, CanOpen: func(string) bool { return false }}),
	}
	defer func() {
		for _, off := range offs {
			off()
		}
	}()
	var ids []string
	for _, c := range Candidates(md) {
		ids = append(ids, c.ID)
	}
	if len(ids) != 3 || ids[0] != "md-long" || ids[1] != "md" || ids[2] != "text" {
		t.Fatalf("candidates = %v", ids)
	}
	if tt, ok := Claim("attention-resource://file/mount/m/a.go", ""); !ok || tt.ID != "text" {
		t.Fatalf("a .go file claims %v %v", tt.ID, ok)
	}
	// By kind: the kind's highest tier, where the veto still holds.
	if _, ok := Claim(md, "markdown"); ok {
		t.Fatal("the extension markdown vetoes, so the kind does not open")
	}
	offs[3]()
	offs = offs[:3]
	if tt, ok := Claim(md, "markdown"); !ok || tt.ID != "md-long" {
		t.Fatalf("by kind = %v %v, want the latest builtin", tt.ID, ok)
	}
	gen := Generation()
	offs[2]()
	offs = offs[:2]
	if Generation() == gen {
		t.Fatal("removing a type changes the generation")
	}
}
