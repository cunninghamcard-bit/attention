// Package webhistoryapi is the in-process web history (attention's
// WebViewerService history): the pages the web viewer showed, newest
// first. The web-history plugin installs it; the web viewer records into
// it and its address bar suggests from it. Main thread only.
package webhistoryapi

import "sync"

// Entry is a visit (WebViewerHistoryEntry).
type Entry struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	VisitedAt string `json:"visitedAt"` // RFC 3339
}

// API is the history.
type API interface {
	// Record notes a visit to url, unless it is the newest entry already;
	// a title given then renames that entry.
	Record(url, title string)
	List() []Entry
	Remove(id string)
	Clear()
}

var (
	mu      sync.Mutex
	current API
)

// Set installs the history; off removes it.
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

// Get is the history, nil while none is loaded.
func Get() API {
	mu.Lock()
	defer mu.Unlock()
	return current
}
