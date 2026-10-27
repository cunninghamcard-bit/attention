// Package layoutapi is the window's layout as the layout plugin provides
// it in process (dsh's ui-layout): the docks' state, for plugins that
// reveal a panel or draw a dock's toggle elsewhere. Main thread only.
package layoutapi

import (
	"sync"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
)

// API is the layout.
type API interface {
	// RevealPanel opens the dock holding the panel and shows the panel.
	RevealPanel(id string)
	// Open reports whether a dock is open.
	Open(d slotsapi.Dock) bool
	// Toggle opens or closes a dock.
	Toggle(d slotsapi.Dock)
}

var (
	mu      sync.Mutex
	current API
)

// Set installs the layout; off removes it.
func Set(a API) (off func()) {
	mu.Lock()
	current = a
	mu.Unlock()
	return func() {
		mu.Lock()
		if current == a {
			current = nil
		}
		mu.Unlock()
	}
}

// Get is the layout, nil while none is loaded.
func Get() API {
	mu.Lock()
	defer mu.Unlock()
	return current
}

// ToggleButton is a dock's toggle, Collapse while it is open and Expand
// while closed (attention's createSidebarToggleButton); nothing without a
// layout.
func ToggleButton(c *ui.Context, d slotsapi.Dock) {
	l := Get()
	if l == nil {
		return
	}
	icon := lucide.PanelLeft()
	if d == slotsapi.Right {
		icon = lucide.PanelRight()
	}
	tip := "Expand"
	if l.Open(d) {
		tip = "Collapse"
	}
	omgui.Button(c, omgui.ButtonProps{Label: tip, Icon: icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
		OnClick: func() { l.Toggle(d) }}).Tooltip(tip)
}
