// Package icon embeds the Lucide icons attention draws that acard-ui's
// icon package lacks, parsed on first use (port of CrychicUI's icon).
package icon

import (
	"embed"
	"slices"
	"strings"
	"sync"

	"github.com/egoist/mygo/ui"
)

var (
	//go:embed svg/*.svg
	files embed.FS

	names = list()
	mu    sync.Mutex
	cache = map[string]*ui.SVG{}
)

// Must returns the icon named name, as Lucide names it ("chevron-right");
// it panics when svg/ has no such icon.
func Must(name string) *ui.SVG {
	mu.Lock()
	defer mu.Unlock()
	if s, ok := cache[name]; ok {
		return s
	}
	if _, ok := slices.BinarySearch(names, name); !ok {
		panic("icon: no icon " + name)
	}
	data, err := files.ReadFile("svg/" + name + ".svg")
	if err != nil {
		panic(err)
	}
	s := ui.MustParseSVG(data)
	cache[name] = s
	return s
}

// Names lists every embedded icon name in order.
func Names() []string { return slices.Clone(names) }

func list() []string {
	entries, err := files.ReadDir("svg")
	if err != nil {
		panic(err)
	}
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = strings.TrimSuffix(e.Name(), ".svg")
	}
	slices.Sort(out)
	return out
}
