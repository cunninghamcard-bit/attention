// Package slots is the in-process slot registry plugin (RFC 0001 §5.5).
package slots

import (
	"encoding/json"
	"sort"
	"strconv"
	"sync"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
)

const (
	// Sidebar is the left sidebar: one panel at a time, picked in its footer.
	Sidebar Dock = iota
	// Context is the right column: every panel a collapsible section.
	Context

	Options     SettingsGroup = 0
	CorePlugins SettingsGroup = 1
)

// Plugin provides the "slots" registry while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "slots",
	Inject: []string{"shell"},
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		var sh *shell.Shell
		if err := ctx.Use("shell", &sh); err != nil {
			return err
		}
		ctx.Provide("slots", New(sh.Invalidate))
		return nil
	},
})

// Dock is where a panel shows.
type Dock int

// PanelProps are what the workspace gives a panel's view.
type PanelProps struct {
	Reveal int
}

// Panel is a dock.panel contribution.
type Panel struct {
	ID      string
	Title   string
	Icon    *ui.SVG
	Dock    Dock
	Order   int
	View    func(c *ui.Context, p PanelProps)
	State   func() json.RawMessage
	Restore func(json.RawMessage)
}

// SidebarHead is what the center draws at the sidebar's top: Nav beside
// the window controls (back and forward), Bar under them (the address bar).
type SidebarHead struct {
	Nav func(c *ui.Context)
	Bar func(c *ui.Context)
}

// Overlay is an overlay contribution (RFC §5.5's overlay slot).
type Overlay struct {
	ID      string
	Order   int
	View    func(c *ui.Context)
	State   func() json.RawMessage
	Restore func(json.RawMessage)
}

// PaletteSource is a palette.source contribution (RFC §5.5).
type PaletteSource struct {
	ID          string
	Placeholder string
	Open        func()
	Items       func(query string) []PaletteItem
	Generation  func() int
	Empty       func(query string) string
	Submit      func(query string) bool
	Footer      func(c *ui.Context, query string)
	State       func() json.RawMessage
	Restore     func(json.RawMessage)
}

// PaletteItem is a palette row.
type PaletteItem struct {
	Key    string
	Label  string
	Detail string
	Icon   *ui.SVG
	Hint   string
	Choose func(newTab bool)
}

// StatusItem is a statusbar.item contribution.
type StatusItem struct {
	ID    string
	Right bool
	Order int
	View  func(c *ui.Context)
}

// SettingsGroup is the header group a settings tab is listed in.
type SettingsGroup int

// SettingsSection is a settings.section contribution (RFC §5.5).
type SettingsSection struct {
	ID       string
	Title    string
	Icon     *ui.SVG
	Group    SettingsGroup
	Order    int
	Keywords []string
	View     func(c *ui.Context)
}

// Registry holds the active UI slot contributions.
type Registry struct {
	mu         sync.Mutex
	inv        func()
	seq        int
	panels     map[int]Panel
	overlays   map[int]Overlay
	sources    map[int]PaletteSource
	paletteReq string
	centerID   int
	centerView func(c *ui.Context)
	headID     int
	head       SidebarHead
	status     map[int]StatusItem
	sections   map[int]SettingsSection
}

// New creates an empty slot registry.
func New(inv func()) *Registry {
	return &Registry{
		inv:      inv,
		panels:   map[int]Panel{},
		overlays: map[int]Overlay{},
		sources:  map[int]PaletteSource{},
		status:   map[int]StatusItem{},
		sections: map[int]SettingsSection{},
	}
}

// LookupPaletteSource looks a source up by ID, returning nil if not found.
func (r *Registry) LookupPaletteSource(id string) *PaletteSource {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.sources {
		if s.ID == id {
			cp := s
			return &cp
		}
	}
	return nil
}

// RegisterPanel adds a panel until off is called.
func (r *Registry) RegisterPanel(p Panel) (off func()) {
	if r == nil {
		return func() {}
	}
	r.mu.Lock()
	for _, q := range r.panels {
		if q.ID == p.ID {
			r.mu.Unlock()
			panic("slots: panel " + strconv.Quote(p.ID) + " is already registered")
		}
	}
	r.seq++
	id := r.seq
	r.panels[id] = p
	r.mu.Unlock()
	r.invalidate()
	return func() {
		r.mu.Lock()
		delete(r.panels, id)
		r.mu.Unlock()
		r.invalidate()
	}
}

// Panels lists a dock's panels by Order, then ID.
func (r *Registry) Panels(d Dock) []Panel {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Panel
	for _, p := range r.panels {
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

// RegisterOverlay adds an overlay until off is called.
func (r *Registry) RegisterOverlay(o Overlay) (off func()) {
	if r == nil {
		return func() {}
	}
	r.mu.Lock()
	for _, q := range r.overlays {
		if q.ID == o.ID {
			r.mu.Unlock()
			panic("slots: overlay " + strconv.Quote(o.ID) + " is already registered")
		}
	}
	r.seq++
	id := r.seq
	r.overlays[id] = o
	r.mu.Unlock()
	r.invalidate()
	return func() {
		r.mu.Lock()
		delete(r.overlays, id)
		r.mu.Unlock()
		r.invalidate()
	}
}

// Overlays lists the overlays by Order, then ID.
func (r *Registry) Overlays() []Overlay {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Overlay, 0, len(r.overlays))
	for _, o := range r.overlays {
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

// RegisterPaletteSource adds a palette source until off is called.
func (r *Registry) RegisterPaletteSource(s PaletteSource) (off func()) {
	if r == nil {
		return func() {}
	}
	r.mu.Lock()
	for _, q := range r.sources {
		if q.ID == s.ID {
			r.mu.Unlock()
			panic("slots: palette source " + strconv.Quote(s.ID) + " is already registered")
		}
	}
	r.seq++
	id := r.seq
	r.sources[id] = s
	r.mu.Unlock()
	r.invalidate()
	return func() {
		r.mu.Lock()
		delete(r.sources, id)
		r.mu.Unlock()
		r.invalidate()
	}
}

// PaletteSources lists the palette sources by ID.
func (r *Registry) PaletteSources() []PaletteSource {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]PaletteSource, 0, len(r.sources))
	for _, s := range r.sources {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// OpenPalette asks the palette to open on source id.
func (r *Registry) OpenPalette(id string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.paletteReq = id
	r.mu.Unlock()
	r.invalidate()
}

// TakePaletteRequest is the palette's: the source last asked for, once.
func (r *Registry) TakePaletteRequest() string {
	if r == nil {
		return ""
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	id := r.paletteReq
	r.paletteReq = ""
	return id
}

// SetCenter makes view the center until off is called; the last set wins.
func (r *Registry) SetCenter(view func(c *ui.Context)) (off func()) {
	if r == nil {
		return func() {}
	}
	r.mu.Lock()
	r.seq++
	id := r.seq
	r.centerID, r.centerView = id, view
	r.mu.Unlock()
	r.invalidate()
	return func() {
		r.mu.Lock()
		if r.centerID == id {
			r.centerID, r.centerView = 0, nil
		}
		r.mu.Unlock()
		r.invalidate()
	}
}

// Center is the center's view, nil for none.
func (r *Registry) Center() func(c *ui.Context) {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.centerView
}

// SetSidebarHead makes h the sidebar's head until off is called; the last
// set wins.
func (r *Registry) SetSidebarHead(h SidebarHead) (off func()) {
	if r == nil {
		return func() {}
	}
	r.mu.Lock()
	r.seq++
	id := r.seq
	r.headID, r.head = id, h
	r.mu.Unlock()
	r.invalidate()
	return func() {
		r.mu.Lock()
		if r.headID == id {
			r.headID, r.head = 0, SidebarHead{}
		}
		r.mu.Unlock()
		r.invalidate()
	}
}

// Head is the sidebar's head; its fields are nil for none.
func (r *Registry) Head() SidebarHead {
	if r == nil {
		return SidebarHead{}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.head
}

// RegisterStatus adds a status bar item until off is called.
func (r *Registry) RegisterStatus(s StatusItem) (off func()) {
	if r == nil {
		return func() {}
	}
	r.mu.Lock()
	for _, q := range r.status {
		if q.ID == s.ID {
			r.mu.Unlock()
			panic("slots: status item " + strconv.Quote(s.ID) + " is already registered")
		}
	}
	r.seq++
	id := r.seq
	r.status[id] = s
	r.mu.Unlock()
	r.invalidate()
	return func() {
		r.mu.Lock()
		delete(r.status, id)
		r.mu.Unlock()
		r.invalidate()
	}
}

// Status lists one side's status bar items by Order, then ID.
func (r *Registry) Status(right bool) []StatusItem {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []StatusItem
	for _, s := range r.status {
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

// RegisterSettingsSection adds a settings section until off is called.
func (r *Registry) RegisterSettingsSection(s SettingsSection) (off func()) {
	if r == nil {
		return func() {}
	}
	r.mu.Lock()
	for _, q := range r.sections {
		if q.ID == s.ID {
			r.mu.Unlock()
			panic("slots: settings section " + strconv.Quote(s.ID) + " is already registered")
		}
	}
	r.seq++
	id := r.seq
	r.sections[id] = s
	r.mu.Unlock()
	r.invalidate()
	return func() {
		r.mu.Lock()
		delete(r.sections, id)
		r.mu.Unlock()
		r.invalidate()
	}
}

// SettingsSections lists the settings sections by Order, then Title.
func (r *Registry) SettingsSections() []SettingsSection {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]SettingsSection, 0, len(r.sections))
	for _, s := range r.sections {
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

func (r *Registry) invalidate() {
	if r.inv != nil {
		r.inv()
	}
}
