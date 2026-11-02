package fileicon

import "testing"

func TestPierreIconsLoad(t *testing.T) {
	cases := []struct {
		name      string
		dir, open bool
	}{
		{"main.go", false, false},
		{"go.mod", false, false},
		{"README.md", false, false},
		{"package.json", false, false},
		{"index.tsx", false, false},
		{"Dockerfile", false, false},
		{"unknown.xyz", false, false},
		{"src", true, false},
		{"src", true, true},
	}
	for _, tc := range cases {
		for _, dark := range []bool{false, true} {
			if svg := Pierre(tc.name, tc.dir, tc.open, dark); svg == nil {
				t.Fatalf("Pierre(%q, dir=%v, open=%v, dark=%v) returned nil", tc.name, tc.dir, tc.open, dark)
			}
		}
	}
}
