package icon

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

func TestEveryReferencedIconIsEmbedded(t *testing.T) {
	ref := regexp.MustCompile(`icon\.Must\("([a-z0-9-]+)"\)`)
	root := filepath.Join("..", "..")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range ref.FindAllSubmatch(data, -1) {
			if _, ok := slices.BinarySearch(names, string(m[1])); !ok {
				t.Errorf("%s: icon %q is not in svg/", path, m[1])
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range names {
		if Must(n) == nil {
			t.Errorf("%s parsed to nil", n)
		}
	}
}
