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
		{"*.md", "attention-resource://file/mount/notes.md/a.go", false},
		{"*.md", "attention-resource://file/absolute/home/x.md/a.go", true},
		{"docs", "attention-resource://file/mount/m/docs/a.go", true},
		{"file", "attention-resource://file/mount/m/a.go", false},
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
		Register(TabType{ID: "notes", Kind: "notes", Priority: Builtin, Patterns: []string{"attention-resource://file/**/*.md"}}),
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
	if len(ids) != 3 || ids[0] != "notes" || ids[1] != "md" || ids[2] != "text" {
		t.Fatalf("candidates = %v", ids)
	}
	if tt, ok := Claim("attention-resource://file/mount/m/a.go", ""); !ok || tt.ID != "text" {
		t.Fatalf("a .go file claims %v %v", tt.ID, ok)
	}
	if tt, ok := Claim("attention-resource://file/mount/m/a.go", "markdown"); !ok || tt.ID != "md" {
		t.Fatalf("by kind, the patterns are not consulted: %v %v", tt.ID, ok)
	}
	gen := Generation()
	offs[2]()
	offs = offs[:2]
	if Generation() == gen {
		t.Fatal("removing a type changes the generation")
	}
}

func TestAnExtensionShadowsTheBuiltinOfItsKind(t *testing.T) {
	const md = "attention-resource://file/mount/m/a.md"
	offBuiltin := Register(TabType{ID: "md", Kind: "markdown", Priority: Builtin, Patterns: []string{"*.md"}})
	defer offBuiltin()
	offExt := Register(TabType{ID: "ext", Kind: "markdown", Patterns: []string{"*.md"}, CanOpen: func(string) bool { return false }})
	if tt, _ := Get("ext"); tt.Priority != Extension {
		t.Fatalf("a type naming no tier is an Extension: %v", tt.Priority)
	}
	if cs := Candidates(md); len(cs) != 0 {
		t.Fatalf("the shadowed builtin is no candidate: %v", cs)
	}
	if _, ok := Claim(md, "markdown"); ok {
		t.Fatal("the extension in force vetoes, and the kind does not open")
	}
	offExt()
	offExt()
	if tt, ok := Claim(md, "markdown"); !ok || tt.ID != "md" {
		t.Fatalf("the builtin resumes: %v %v", tt.ID, ok)
	}
}

func TestWiringMistakesPanic(t *testing.T) {
	off := Register(TabType{ID: "md", Kind: "markdown", Priority: Builtin})
	defer off()
	offText := Register(TabType{ID: "text", Kind: "text", Priority: Fallback})
	defer offText()
	offExt := Register(TabType{ID: "ext", Kind: "markdown"})
	defer offExt()
	offSolo := Register(TabType{ID: "solo", Kind: "solo", Priority: Builtin})
	defer offSolo()
	for name, tt := range map[string]TabType{
		"the same id":              {ID: "md", Kind: "other", Priority: Builtin},
		"a third of a kind":        {ID: "md2", Kind: "markdown", Priority: Builtin},
		"a kind beside fallback":   {ID: "text2", Kind: "text", Priority: Builtin},
		"a fallback beside a kind": {ID: "solo2", Kind: "solo", Priority: Fallback},
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s does not panic", name)
				}
			}()
			Register(tt)()
		}()
	}
}
