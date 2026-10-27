// Package tabtypesapi is the in-process tab type registry (RFC 0001 §5.6):
// a tab type says which resource addresses it shows and draws a tab's body.
// The workspace claims an address on open and draws the claimed type's
// Body in the tab.body slot, keyed by the type's ID, not its kind, so a
// plugin taking over a kind keeps working.
//
// Until the resources service lands (RFC §5.6 "resources"), the workspace
// stands in for it: it watches the open tabs' files and hands each body a
// Version that bumps on change and a Missing flag. A viewer reads through
// the fs service itself and never subscribes to fs changes.
//
// Views run on the main thread (RFC §5.8).
package tabtypesapi

import (
	"net/url"
	"path"
	"sort"
	"strings"
	"sync"

	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

// Priority is a claim's tier; a higher tier wins.
type Priority int

const (
	Fallback  Priority = iota // a viewer for anything, as plain text
	Builtin                   // the reader's own viewers
	Extension                 // other plugins'
)

// Nav is where to put the reader in the opened file, 1-based. Line alone
// selects the line; Col (in bytes) and Len select a match within it; To
// selects lines Line through To.
type Nav struct {
	Line, To int
	Col, Len int
}

// Info is a tab as its body sees it (dsh's UseTabInfo).
type Info struct {
	ID      int // the tab's id, unique for the run
	Kind    string
	Address string
	Path    string // the file, absolute
	// Nav is the last navigation; NavRevision bumps on every navigation,
	// even one to the same place.
	Nav         *Nav
	NavRevision int
	// Version bumps when the file changed on disk; Missing is set while it
	// is deleted or moved away.
	Version int
	Missing bool
	Focused bool // the tab is its pane's active one in the focused pane
}

// Props are what the workspace gives a body.
type Props struct {
	Info Info
	// MarkMissing tells the workspace the body found the file gone.
	MarkMissing func()
}

// TabType is a tab type's definition and body.
type TabType struct {
	ID   string // unique; the tab.body key
	Kind string // what OpenTab names; several types may share one
	// Patterns are the addresses it claims: one with a ":" matches the
	// whole address ("**" any number of segments), one without matches any
	// segment of the address's path, without case ("*.md").
	Patterns []string
	Priority Priority
	CanOpen  func(address string) bool // optional veto of a pattern match
	Title    func(address string) string
	Body     func(c *ui.Context, p Props)
	// Status, optional, draws the tab's status bar items.
	Status func(c *ui.Context, p Props)
	// Closed, optional, drops a closed tab's state.
	Closed func(tabID int)
	// Lines, optional, is a text tab's caret line (1-based) and line
	// count, false before its text is loaded: Go to line works on it.
	Lines func(tabID int) (cur, lines int, ok bool)
}

var (
	mu    sync.Mutex
	seq   int
	gen   int
	types = map[int]TabType{}
)

// Register adds a tab type until off is called.
func Register(t TabType) (off func()) {
	mu.Lock()
	seq++
	id := seq
	types[id] = t
	gen++
	mu.Unlock()
	invalidate()
	return func() {
		mu.Lock()
		delete(types, id)
		gen++
		mu.Unlock()
		invalidate()
	}
}

// Generation changes whenever a type is registered or removed.
func Generation() int {
	mu.Lock()
	defer mu.Unlock()
	return gen
}

// Get is the type registered under id.
func Get(id string) (TabType, bool) {
	mu.Lock()
	defer mu.Unlock()
	for _, k := range order() {
		if types[k].ID == id {
			return types[k], true
		}
	}
	return TabType{}, false
}

// order is the registrations' keys, oldest first. Called with mu held.
func order() []int {
	keys := make([]int, 0, len(types))
	for k := range types {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	return keys
}

// Candidates are the types that can show address, best first: by tier,
// then by the longest matching pattern, then by registration.
func Candidates(address string) []TabType {
	mu.Lock()
	type cand struct {
		t     TabType
		score int
	}
	var cs []cand
	for _, k := range order() {
		t := types[k]
		best := -1
		for _, p := range t.Patterns {
			if Match(p, address) && len(p) > best {
				best = len(p)
			}
		}
		if best >= 0 {
			cs = append(cs, cand{t, best})
		}
	}
	mu.Unlock()
	sort.SliceStable(cs, func(i, j int) bool {
		if cs[i].t.Priority != cs[j].t.Priority {
			return cs[i].t.Priority > cs[j].t.Priority
		}
		return cs[i].score > cs[j].score
	})
	var out []TabType
	for _, c := range cs {
		if c.t.CanOpen == nil || c.t.CanOpen(address) {
			out = append(out, c.t)
		}
	}
	return out
}

// Claim is the type that shows address: the best candidate, or with kind
// the kind's current implementation (the highest tier, then the latest).
func Claim(address, kind string) (TabType, bool) {
	if kind == "" {
		cs := Candidates(address)
		if len(cs) == 0 {
			return TabType{}, false
		}
		return cs[0], true
	}
	mu.Lock()
	var found *TabType
	for _, k := range order() {
		t := types[k]
		if t.Kind == kind && (found == nil || t.Priority >= found.Priority) {
			found = &t
		}
	}
	mu.Unlock()
	if found == nil || (found.CanOpen != nil && !found.CanOpen(address)) {
		return TabType{}, false
	}
	return *found, true
}

// Match reports whether pattern matches address (see TabType.Patterns).
func Match(pattern, address string) bool {
	if strings.Contains(pattern, ":") {
		return matchSegments(strings.Split(pattern, "/"), strings.Split(address, "/"))
	}
	_, rest, ok := strings.Cut(address, "://")
	if !ok {
		return false
	}
	pattern = strings.ToLower(pattern)
	for _, seg := range strings.Split(rest, "/") {
		if s, err := url.PathUnescape(seg); err == nil {
			seg = s
		}
		if ok, _ := path.Match(pattern, strings.ToLower(seg)); ok {
			return true
		}
	}
	return false
}

// matchSegments is a glob over "/"-separated segments: "**" matches any
// number of them, other segments match as path.Match.
func matchSegments(pat, segs []string) bool {
	if len(pat) == 0 {
		return len(segs) == 0
	}
	if pat[0] == "**" {
		for i := 0; i <= len(segs); i++ {
			if matchSegments(pat[1:], segs[i:]) {
				return true
			}
		}
		return false
	}
	if len(segs) == 0 {
		return false
	}
	if ok, _ := path.Match(pat[0], segs[0]); !ok {
		return false
	}
	return matchSegments(pat[1:], segs[1:])
}

func invalidate() {
	if w := shellapi.Window(); w != nil {
		w.Invalidate()
	}
}
