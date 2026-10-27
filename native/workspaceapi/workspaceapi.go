// Package workspaceapi is what the workspace plugin offers other UI
// plugins in the same process: opening a file in a tab, the active file,
// display paths, revealing a panel. Panel plugins inject the "workspace"
// service so rutis orders them after it, then call Get on the main thread.
//
// TODO(RFC §5.6): opening becomes navigation.OpenResource.
package workspaceapi

import (
	"sync"

	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
)

// Nav is where to put the reader in the opened file (tabtypesapi.Nav).
type Nav = tabtypesapi.Nav

// API is the workspace, called on the main thread only.
type API interface {
	// Open shows path in the active pane (a new tab with newTab).
	Open(path string, nav *Nav, newTab bool)
	// ActivePath is the active tab's file, "" for none.
	ActivePath() string
	// ActiveTab is the active tab, false for none or a new tab.
	ActiveTab() (tabtypesapi.Info, bool)
	// Display is a path as the reader shows it: "<mount>/<rel>".
	Display(path string) string
	// RevealPanel opens the dock holding the panel and shows the panel.
	RevealPanel(id string)
}

var (
	mu      sync.Mutex
	current API
)

// Set installs the workspace; off removes it.
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

// Get is the workspace, nil while none is loaded.
func Get() API {
	mu.Lock()
	defer mu.Unlock()
	return current
}
