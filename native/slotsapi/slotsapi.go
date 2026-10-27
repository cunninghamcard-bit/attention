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
// every frame over the window's content in Order, those below zero before
// the content (key handlers, whose commands then show in the same frame),
// the others after it. A modal draws nothing while closed.
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

// PaletteSource is a palette.source contribution (RFC §5.5): one of the
// palette's modes (attention's quick switcher, command palette, go to
// line). The palette plugin draws it; OpenPalette opens it.
type PaletteSource struct {
	ID          string
	Placeholder string
	// Open, optional, runs when the palette opens on the source.
	Open func()
	// Items are the rows for query, best first. The palette asks again
	// when the query or Generation changes.
	Items func(query string) []PaletteItem
	// Generation, optional, changes when Items would change for the same
	// query (a file listing arrived).
	Generation func() int
	// Empty is the message with no rows for query.
	Empty func(query string) string
	// Submit, optional, is Enter with no row: true closes the palette.
	Submit func(query string) bool
	// Footer, optional, draws under the rows.
	Footer func(c *ui.Context, query string)
	// State and Restore are a Panel's.
	State   func() json.RawMessage
	Restore func(json.RawMessage)
}

// PaletteItem is a palette row.
type PaletteItem struct {
	Key    string
	Label  string
	Detail string // muted, after the label
	Icon   *ui.SVG
	Hint   string // trailing, as a shortcut
	// Choose runs the row; newTab is Mod Enter or a Mod click.
	Choose func(newTab bool)
}

var (
	sources    = map[int]PaletteSource{}
	paletteReq string // the source OpenPalette asked for, until taken
)

// RegisterPaletteSource adds a palette source until off is called; a second
// live source with the same ID panics.
func RegisterPaletteSource(s PaletteSource) (off func()) {
	mu.Lock()
	for _, q := range sources {
		if q.ID == s.ID {
			mu.Unlock()
			panic("slots: palette source " + strconv.Quote(s.ID) + " is already registered")
		}
	}
	seq++
	id := seq
	sources[id] = s
	mu.Unlock()
	invalidate()
	return func() {
		mu.Lock()
		delete(sources, id)
		mu.Unlock()
		invalidate()
	}
}

// PaletteSources lists the palette sources by ID.
func PaletteSources() []PaletteSource {
	mu.Lock()
	defer mu.Unlock()
	out := make([]PaletteSource, 0, len(sources))
	for _, s := range sources {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// LookupPaletteSource looks a source up by ID.
func LookupPaletteSource(id string) (PaletteSource, bool) {
	mu.Lock()
	defer mu.Unlock()
	for _, s := range sources {
		if s.ID == id {
			return s, true
		}
	}
	return PaletteSource{}, false
}

// OpenPalette asks the palette to open on source id; asked again while
// open on it, the palette closes. Main thread only.
func OpenPalette(id string) {
	mu.Lock()
	paletteReq = id
	mu.Unlock()
	invalidate()
}

// TakePaletteRequest is the palette's: the source last asked for, once.
func TakePaletteRequest() string {
	mu.Lock()
	defer mu.Unlock()
	id := paletteReq
	paletteReq = ""
	return id
}

// center is the workspace.center slot (RFC §5.5): the one view between the
// docks.
var center struct {
	id   int
	view func(c *ui.Context)
}

// SetCenter makes view the center until off is called; the last set wins.
func SetCenter(view func(c *ui.Context)) (off func()) {
	mu.Lock()
	seq++
	id := seq
	center.id, center.view = id, view
	mu.Unlock()
	invalidate()
	return func() {
		mu.Lock()
		if center.id == id {
			center.id, center.view = 0, nil
		}
		mu.Unlock()
		invalidate()
	}
}

// Center is the center's view, nil for none.
func Center() func(c *ui.Context) {
	mu.Lock()
	defer mu.Unlock()
	return center.view
}

// StatusItem is a statusbar.item contribution: drawn in the status bar,
// on the left or the right, in Order.
type StatusItem struct {
	ID    string
	Right bool
	Order int
	View  func(c *ui.Context)
}

var status = map[int]StatusItem{}

// RegisterStatus adds a status bar item until off is called; a second live
// item with the same ID panics.
func RegisterStatus(s StatusItem) (off func()) {
	mu.Lock()
	for _, q := range status {
		if q.ID == s.ID {
			mu.Unlock()
			panic("slots: status item " + strconv.Quote(s.ID) + " is already registered")
		}
	}
	seq++
	id := seq
	status[id] = s
	mu.Unlock()
	invalidate()
	return func() {
		mu.Lock()
		delete(status, id)
		mu.Unlock()
		invalidate()
	}
}

// Status lists one side's status bar items by Order, then ID.
func Status(right bool) []StatusItem {
	mu.Lock()
	defer mu.Unlock()
	var out []StatusItem
	for _, s := range status {
		if s.Right == right {
			out = append(out, s)
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

// SettingsSection is a settings.section contribution (RFC §5.5): a tab
// of the settings modal, attention's SettingTab, listed in its group by
// Order, then Title.
type SettingsSection struct {
	ID    string
	Title string
	Icon  *ui.SVG
	// Group is the sidebar group: "" for Options, CorePlugins for a core
	// plugin's own tab (SettingsRenderer's sections).
	Group string
	Order int
	// Keywords are what Search settings also finds the tab by, as the
	// names of its settings.
	Keywords []string
	View     func(c *ui.Context)
}

// CorePlugins is the settings group of the core plugins' own tabs.
const CorePlugins = "core-plugins"

var sections = map[int]SettingsSection{}

// RegisterSettingsSection adds a settings section until off is called; a
// second live section with the same ID panics.
func RegisterSettingsSection(s SettingsSection) (off func()) {
	mu.Lock()
	for _, q := range sections {
		if q.ID == s.ID {
			mu.Unlock()
			panic("slots: settings section " + strconv.Quote(s.ID) + " is already registered")
		}
	}
	seq++
	id := seq
	sections[id] = s
	mu.Unlock()
	invalidate()
	return func() {
		mu.Lock()
		delete(sections, id)
		mu.Unlock()
		invalidate()
	}
}

// SettingsSections lists the settings sections by Order, then Title.
func SettingsSections() []SettingsSection {
	mu.Lock()
	defer mu.Unlock()
	out := make([]SettingsSection, 0, len(sections))
	for _, s := range sections {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].Title < out[j].Title
	})
	return out
}
