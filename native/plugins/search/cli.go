package search

import (
	"context"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/layoutapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

// commands are the panel's palette command and search:open, the CLI's
// (apps/web/app/cli/commands/searchCli.ts); search and search:context are
// the project's, so they run headless.
func (s *Search) commands() []actionsapi.Command {
	reveal := func() {
		if l := layoutapi.Get(); l != nil {
			l.RevealPanel(PanelID)
		}
	}
	return []actionsapi.Command{
		{ID: "global-search:open", Title: "Search in all files", Keys: "Ctrl Shift F", Main: reveal, Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			return shellapi.OnMain(ctx, func() (string, error) { reveal(); return "", nil })
		}},
		{ID: "search:open", CLI: true, Run: s.cliSearchOpen},
	}
}

// cliSearchOpen is `search:open [query=<text>]`: reveal the Search panel and
// set its field, as SearchView.setState({ query }) does.
func (s *Search) cliSearchOpen(ctx context.Context, a actionsapi.Args) (string, error) {
	q := a.Params["query"]
	return shellapi.OnMain(ctx, func() (string, error) {
		s.setQuery(q)
		if l := layoutapi.Get(); l != nil {
			l.RevealPanel(PanelID)
		}
		if q != "" {
			return "Opened search: " + q, nil
		}
		return "Opened search", nil
	})
}
