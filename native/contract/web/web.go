// Package web is the web viewer's events (RFC 0001 §5.6): what a plugin
// that follows the pages it shows — web-index — hears, with no dependency
// of the web viewer on it.
package web

import "encoding/json"

const (
	// PageLoadedEvent is emitted by the web plugin when a page finished
	// loading, with its Page.
	PageLoadedEvent = "web/page-loaded"

	// HistoryClearedEvent is emitted by the web-history plugin when its
	// history was cleared, with no arguments.
	HistoryClearedEvent = "web-history/cleared"
)

// Page is a loaded page's article (internal/htmlextract), as markdown.
type Page struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	Markdown string `json:"markdown"`
}

// DecodePage is an event's Page, in process or across one.
func DecodePage(arg any) (Page, error) {
	if p, ok := arg.(Page); ok {
		return p, nil
	}
	data, err := json.Marshal(arg)
	if err != nil {
		return Page{}, err
	}
	var p Page
	err = json.Unmarshal(data, &p)
	return p, err
}
