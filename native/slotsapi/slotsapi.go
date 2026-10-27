// Package slotsapi is the in-process slot registry (RFC 0001 §5.5). The
// first slots are dock.panel — the sidebars' panels, attention's left and
// right side leaves — the ribbon, attention's vertical action strip, and
// overlay, drawn over the window (modals, key handling).
// UI plugins register in Apply and hand the returned off to ctx.Effect;
// the registry is keyed by registration, not by plugin row (rutis's Ctx
// has no row id).
//
// Views run on the main thread (RFC §5.8): they read their plugin's state
// and never call services or the disk.
package slotsapi

import (
	"encoding/json"
	"sort"
	"strconv"
	"sync"

	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

// Dock is a sidebar.
type Dock int

const (
	Left Dock = iota
	Right
)

// PanelProps are what the workspace gives a panel's view.
type PanelProps struct {
	// Reveal counts the times the panel was revealed (its command, its
	// header button): a view that has an input focuses it when it changes.
	Reveal int
}

// Panel is a dock.panel contribution.
type Panel struct {
	ID    string
	Title string
	Icon  *ui.SVG
	Dock  Dock
	Order int // lower first
	View  func(c *ui.Context, p PanelProps)
	// State and Restore, both optional, carry the panel's state across
	// runs in the session (an ItemView's getState and setState). Restore
	// runs on the main thread before the panel is first drawn.
	State   func() json.RawMessage
	Restore func(json.RawMessage)
}

// RibbonItem is a ribbon contribution: an icon running an action.
type RibbonItem struct {
	ID    string
	Title string
	Icon  *ui.SVG
	Order int
	Run   func()
}

// Overlay is an overlay contribution (RFC §5.5's overlay slot): drawn
// every frame over the window's content, after it, in Order. A modal draws
// nothing while closed; one handling keys reads them here.
type Overlay struct {
	ID    string
	Order int
	View  func(c *ui.Context)
	// State and Restore are a Panel's: carried across runs in the session,
	// Restore before the first draw.
	State   func() json.RawMessage
	Restore func(json.RawMessage)
}

var (
	mu       sync.Mutex
	seq      int
	panels   = map[int]Panel{}
	ribbon   = map[int]RibbonItem{}
	overlays = map[int]Overlay{}
)

// RegisterPanel adds a panel until off is called. A second live panel with
// the same ID is a wiring mistake and panics (dsh throws on a cell taken).
func RegisterPanel(p Panel) (off func()) {
	mu.Lock()
	for _, q := range panels {
		if q.ID == p.ID {
			mu.Unlock()
			panic("slots: panel " + strconv.Quote(p.ID) + " is already registered")
		}
	}
	seq++
	id := seq
	panels[id] = p
	mu.Unlock()
	invalidate()
	return func() {
		mu.Lock()
		delete(panels, id)
		mu.Unlock()
		invalidate()
	}
}

// Panels lists a dock's panels by Order, then ID.
func Panels(d Dock) []Panel {
	mu.Lock()
	defer mu.Unlock()
	var out []Panel
	for _, p := range panels {
		if p.Dock == d {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// RegisterRibbon adds a ribbon item until off is called; a second live item
// with the same ID panics.
func RegisterRibbon(r RibbonItem) (off func()) {
	mu.Lock()
	for _, q := range ribbon {
		if q.ID == r.ID {
			mu.Unlock()
			panic("slots: ribbon item " + strconv.Quote(r.ID) + " is already registered")
		}
	}
	seq++
	id := seq
	ribbon[id] = r
	mu.Unlock()
	invalidate()
	return func() {
		mu.Lock()
		delete(ribbon, id)
		mu.Unlock()
		invalidate()
	}
}

// Ribbon lists the ribbon items by Order, then ID.
func Ribbon() []RibbonItem {
	mu.Lock()
	defer mu.Unlock()
	out := make([]RibbonItem, 0, len(ribbon))
	for _, r := range ribbon {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// RegisterOverlay adds an overlay until off is called; a second live
// overlay with the same ID panics.
func RegisterOverlay(o Overlay) (off func()) {
	mu.Lock()
	for _, q := range overlays {
		if q.ID == o.ID {
			mu.Unlock()
			panic("slots: overlay " + strconv.Quote(o.ID) + " is already registered")
		}
	}
	seq++
	id := seq
	overlays[id] = o
	mu.Unlock()
	invalidate()
	return func() {
		mu.Lock()
		delete(overlays, id)
		mu.Unlock()
		invalidate()
	}
}

// Overlays lists the overlays by Order, then ID.
func Overlays() []Overlay {
	mu.Lock()
	defer mu.Unlock()
	out := make([]Overlay, 0, len(overlays))
	for _, o := range overlays {
		out = append(out, o)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func invalidate() {
	if w := shellapi.Window(); w != nil {
		w.Invalidate()
	}
}
