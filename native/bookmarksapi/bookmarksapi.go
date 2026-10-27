// Package bookmarksapi is the in-process bookmarks: what the web viewer's
// address bar suggests from them (getUrlBookmarks). The bookmarks plugin
// installs it. Main thread only.
package bookmarksapi

import "sync"

// URL is a url bookmark.
type URL struct {
	Title, URL string
}

// API is the bookmarks.
type API interface {
	// URLs are the url bookmarks, groups' included, in order.
	URLs() []URL
}

var (
	mu      sync.Mutex
	current API
)

// Set installs the bookmarks; off removes them.
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

// Get is the bookmarks, nil while none are loaded.
func Get() API {
	mu.Lock()
	defer mu.Unlock()
	return current
}
