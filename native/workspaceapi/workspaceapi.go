// Package workspaceapi is what the workspace plugin offers other UI
// plugins in the same process: opening a file in a tab, the active file,
// display paths, revealing a panel. Panel plugins inject the "workspace"
// service so rutis orders them after it, then call Get on the main thread.
//
// OpenResource is the one way in (dsh's sidebarRight.openResource); Open
// is it for a path. TODO(RFC §5.6): OpenTab and page addresses
// (attention://<kind>) come with the first page type.
package workspaceapi

import (
	"context"
	"sync"

	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
)

// Nav is where to put the reader in the opened file (tabtypesapi.Nav).
type Nav = tabtypesapi.Nav

// OpenOptions are how a resource opens.
type OpenOptions struct {
	Nav    *Nav
	NewTab bool // another tab even when one shows the resource
	// Kind, optional, names the tab type to show it with; its patterns are
	// not consulted, its CanOpen is. A tab keeps it across reclaims.
	Kind string
}

// API is the workspace, called on the main thread only, ResolveLink
// excepted.
type API interface {
	// ResolveLink is the file a link names, as the CLI's open file= finds
	// it: a path from dir with or without ".md", else the first file of
	// the mounts whose path ends with it, without case (attention's
	// getFirstLinkpathDest, roughly). It reads the disk: call it off the
	// main thread.
	ResolveLink(ctx context.Context, link, dir string) (string, error)
	// OpenResource shows a resource address: the tab that shows it as the
	// same kind, else the active tab navigates to it (a new tab with
	// NewTab). An address that is no file under a known mount or absolute,
	// or a Kind that does not open it, is an error and opens nothing; a
	// file no type claims opens a tab that says so.
	OpenResource(address string, o OpenOptions) error
	// Open is OpenResource for path (a new tab with newTab).
	Open(path string, nav *Nav, newTab bool)
	// OpenTab shows the page of kind (tabtypesapi.PageAddress) as
	// OpenResource shows an address; a kind no type registers is an
	// error.
	OpenTab(kind string, o OpenOptions) error
	// ActivePath is the active tab's file, "" for none.
	ActivePath() string
	// ActiveTab is the active tab, false for none or a new tab.
	ActiveTab() (tabtypesapi.Info, bool)
	// Display is a path as the reader shows it: "<mount>/<rel>".
	Display(path string) string
	// RecentFiles are the files opened last, newest first (the quick
	// switcher's recent list).
	RecentFiles() []string
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
