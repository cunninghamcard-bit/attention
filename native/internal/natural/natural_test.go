package natural

import (
	"sort"
	"testing"
)

func TestLess(t *testing.T) {
	in := []string{"d10", "D2", "d1", "a.md", "B.md", "d02x", "n100.md", "n20.md"}
	sort.SliceStable(in, func(i, j int) bool { return Less(in[i], in[j]) })
	want := []string{"a.md", "B.md", "d1", "D2", "d02x", "d10", "n20.md", "n100.md"}
	for i := range want {
		if in[i] != want[i] {
			t.Fatalf("got %v, want %v", in, want)
		}
	}
}
