package search

import (
	"context"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
)

// commands are the panel's palette command and search:open, the CLI's
// (apps/web/app/cli/commands/searchCli.ts); search and search:context are
// the project's, so they run headless.
func (s *Search) commands() []actions.Command {
	reveal := func() {
		if s.lyt != nil {
			s.lyt.RevealPanel(PanelID)
		}
	}
	return []actions.Command{
		{ID: "global-search:open", Title: "Search in all files", Keys: "Ctrl Shift F", Main: reveal, Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, s.sh, func() (string, error) { reveal(); return "", nil })
		}},
		{ID: "search:open", CLI: true, Run: s.cliSearchOpen},
	}
}

// cliSearchOpen is `search:open [query=<text>]`: reveal the Search panel and
// set its field, as SearchView.setState({ query }) does.
func (s *Search) cliSearchOpen(ctx context.Context, a actions.Args) (string, error) {
	q := a.Params["query"]
	return shell.OnMain(ctx, s.sh, func() (string, error) {
		s.setQuery(q)
		if s.lyt != nil {
			s.lyt.RevealPanel(PanelID)
		}
		if q != "" {
			return "Opened search: " + q, nil
		}
		return "Opened search", nil
	})
}
