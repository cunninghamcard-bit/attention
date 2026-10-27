// Package tabtypesapi is the in-process tab type registry (RFC 0001 §5.6):
// a tab type says which resource addresses it shows and draws a tab's body.
// The workspace claims an address on open and draws the claimed type's
// Body in the tab.body slot, keyed by the type's ID, not its kind, so a
// plugin taking over a kind keeps working.
//
// A tab holds its address in resourcesapi for its life; the workspace hands
// each body the resource's Version, which bumps when the file changes, and
// a Missing flag. A viewer reads through the fs service itself and never
// subscribes to fs changes.
//
// Views run on the main thread (RFC §5.8).
package tabtypesapi

import (
	"net/url"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/egoist/mygo/ui"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

// Priority is a claim's tier; a higher tier wins. A type that names none
// is an Extension (dsh's DEFAULT_BAND).
type Priority int

const (
	Fallback  Priority = iota + 1 // a viewer for anything, as plain text
	Builtin                       // the reader's own viewers
	Extension                     // other plugins'
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
	// Version bumps when the file changed on disk; Pending is set until
	// its first state is known, and a body waits to read it; Missing is set
	// while it is deleted or moved away.
	Version int
	Pending bool
	Missing bool
	Focused bool // the tab is its pane's active one in the focused pane
}

// Props are what the workspace gives a body.
type Props struct {
	Info Info
	// Retarget, for a page that navigates itself (a web page), makes the
	// tab show address under title in place, the address it showed kept
	// in its history (an ItemView's navigation, WorkspaceLeaf's pushState).
	Retarget func(address, title string)
	// SetTitle renames the tab (a page's title came).
	SetTitle func(title string)
}

// TabType is a tab type's definition and body.
type TabType struct {
	ID   string // unique; the tab.body key
	Kind string // what OpenTab names; a Builtin and an Extension may share one
	// Patterns are the addresses it claims: one with a ":" matches the
	// whole address ("**" any number of segments), one without matches any
	// layer of the path the address names, without case ("*.md"; for a
	// file address, not its scope or mount id).
	Patterns []string
	Priority Priority                  // zero: Extension
	CanOpen  func(address string) bool // optional veto of a pattern match
	Title    func(address string) string
	// Icon, optional, is the tab's icon; a file's follows its name.
	Icon *ui.SVG
	Body func(c *ui.Context, p Props)
	// Status, optional, draws the tab's status bar items.
	Status func(c *ui.Context, p Props)
	// Actions, optional, draws the tab's buttons in its view header, left
	// of More options (attention's ItemView.addAction).
	Actions func(c *ui.Context, p Props)
	// Header, optional, draws in the view header in place of the file's
	// folders and name (the web viewer's reload button and address bar).
	Header func(c *ui.Context, p Props)
	// Menu, optional, is the tab's own items in More options
	// (View.onPaneMenu).
	Menu func(tabID int) []MenuItem
	// Closed, optional, drops a closed tab's state.
	Closed func(tabID int)
	// Lines, optional, is a text tab's caret line (1-based) and line
	// count, false before its text is loaded: Go to line works on it.
	Lines func(tabID int) (cur, lines int, ok bool)
}

// MenuItem is an entry a tab type adds to its tab's More options.
type MenuItem struct {
	Title   string
	Icon    *ui.SVG
	Checked bool
	Run     func()
}

// kindSlot is a kind's registrations: the one in force and the one it
// shadows. A Builtin and an Extension pair up once, the Extension in
// force; a Fallback shares its kind with nothing.
// Port of dsh's KindSlot (ui-sidebar-right/src/client/tab-registry.ts).
type kindSlot struct {
	inForce, shadowed int // registration keys; shadowed 0 for none
}

var (
	mu    sync.Mutex
	seq   int
	gen   int
	types = map[int]TabType{}
	ids   = map[string]bool{}
	kinds = map[string]*kindSlot{}
)

// coexists reports whether a type of tier p may join slot.
func coexists(slot *kindSlot, p Priority) bool {
	held := types[slot.inForce].Priority
	return p != Fallback && held != Fallback && held != p && slot.shadowed == 0
}

// Register adds a tab type until off is called. A second type with the same
// ID, or one its kind cannot take (see kindSlot), is a wiring mistake and
// panics.
func Register(t TabType) (off func()) {
	if t.Priority == 0 {
		t.Priority = Extension
	}
	mu.Lock()
	if ids[t.ID] {
		mu.Unlock()
		panic("tabtypes: tab type id " + strconv.Quote(t.ID) + " is already registered")
	}
	slot := kinds[t.Kind]
	if slot != nil && !coexists(slot, t.Priority) {
		mu.Unlock()
		panic("tabtypes: tab kind " + strconv.Quote(t.Kind) + " is already registered")
	}
	seq++
	id := seq
	types[id] = t
	ids[t.ID] = true
	switch {
	case slot == nil:
		kinds[t.Kind] = &kindSlot{inForce: id}
	case t.Priority > types[slot.inForce].Priority:
		slot.shadowed, slot.inForce = slot.inForce, id
	default:
		slot.shadowed = id
	}
	gen++
	mu.Unlock()
	invalidate()
	var once sync.Once
	return func() {
		once.Do(func() {
			mu.Lock()
			slot := kinds[t.Kind]
			switch {
			case slot.inForce != id:
				slot.shadowed = 0
			case slot.shadowed == 0:
				delete(kinds, t.Kind)
			default:
				slot.inForce, slot.shadowed = slot.shadowed, 0
			}
			delete(types, id)
			delete(ids, t.ID)
			gen++
			mu.Unlock()
			invalidate()
		})
	}
}

// Generation changes whenever a type is registered or removed.
func Generation() int {
	mu.Lock()
	defer mu.Unlock()
	return gen
}

// Get is the type registered under id, in force or shadowed.
func Get(id string) (TabType, bool) {
	mu.Lock()
	defer mu.Unlock()
	for _, t := range types {
		if t.ID == id {
			return t, true
		}
	}
	return TabType{}, false
}

// active is each kind's type in force, oldest first. Called with mu held.
func active() []int {
	keys := make([]int, 0, len(kinds))
	for _, slot := range kinds {
		keys = append(keys, slot.inForce)
	}
	sort.Ints(keys)
	return keys
}

// Candidates are the types in force that can show address, best first: by
// tier, then by the longest matching pattern, then by registration.
func Candidates(address string) []TabType {
	mu.Lock()
	type cand struct {
		t     TabType
		score int
	}
	var cs []cand
	for _, k := range active() {
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
// the kind's type in force, its patterns not consulted (naming the kind is
// the decision) but its CanOpen still is.
func Claim(address, kind string) (TabType, bool) {
	if kind == "" {
		cs := Candidates(address)
		if len(cs) == 0 {
			return TabType{}, false
		}
		return cs[0], true
	}
	mu.Lock()
	slot := kinds[kind]
	var t TabType
	if slot != nil {
		t = types[slot.inForce]
	}
	mu.Unlock()
	if slot == nil || (t.CanOpen != nil && !t.CanOpen(address)) {
		return TabType{}, false
	}
	return t, true
}

// PageAddress is the address of the page of kind, a tab that shows no
// resource (RFC §5.6 page addresses, dsh's sidebar://<kind>): OpenTab
// opens it, its type claims it by kind.
func PageAddress(kind string) string { return "attention://" + kind }

// PageKind is the kind a page address names, false for another address.
func PageKind(address string) (string, bool) {
	kind, ok := strings.CutPrefix(address, "attention://")
	return kind, ok && kind != "" && !strings.Contains(kind, "/")
}

// WebAddress reports whether address is a web page's, which a tab shows
// with no file: http(s) or about.
func WebAddress(address string) bool {
	scheme, _, ok := strings.Cut(address, ":")
	if !ok {
		return false
	}
	switch strings.ToLower(scheme) {
	case "http", "https", "about":
		return true
	}
	return false
}

// Match reports whether pattern matches address (see TabType.Patterns).
func Match(pattern, address string) bool {
	if strings.Contains(pattern, ":") {
		return matchSegments(strings.Split(pattern, "/"), strings.Split(address, "/"))
	}
	pattern = strings.ToLower(pattern)
	for _, seg := range pathSegments(address) {
		if ok, _ := path.Match(pattern, strings.ToLower(seg)); ok {
			return true
		}
	}
	return false
}

// pathSegments are the layers of the path an address names: a file
// address's path under its mount or the root, without the protocol, the
// scope or the mount id; another protocol's segments after its name.
func pathSegments(address string) []string {
	if a, ok := fscontract.ParseAddress(address); ok {
		p := a.Rel
		if a.Abs != "" {
			p = strings.TrimPrefix(filepath.ToSlash(a.Abs), "/")
		}
		return strings.Split(p, "/")
	}
	_, rest, ok := strings.Cut(address, "://")
	if !ok {
		return nil
	}
	segs := strings.Split(rest, "/")[1:]
	for i, seg := range segs {
		if s, err := url.PathUnescape(seg); err == nil {
			segs[i] = s
		}
	}
	return segs
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
