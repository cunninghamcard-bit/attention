// Package webread is the CLI's web:read (RFC 0001 roadmap P3): a page's
// readable text as markdown for an agent, fetched with no web view, so it
// runs headless too (internal/htmlextract).
package webread

import (
	"context"
	"fmt"
	"strings"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/internal/htmlextract"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
)

// ID is the plugin's name.
const ID = "web-read"

// Plugin registers web:read while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var act *actions.Service
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		off := act.Add(actions.Command{ID: "web:read", CLI: true, Run: read})
		rctx.Effect(func(context.Context) error {
			off()
			return nil
		})
		return nil
	},
})

// read is `web:read url=<url>`: the page's title, its address after
// redirects, its article; a URL with no scheme goes over https, as web's.
func read(ctx context.Context, a actions.Args) (string, error) {
	address := a.Params["url"]
	if address == "" {
		return "", fmt.Errorf("Missing required parameter: url\nUsage: web:read url=<url>")
	}
	if !strings.Contains(address, "://") {
		address = "https://" + address
	}
	html, final, err := htmlextract.Fetch(ctx, address)
	if err != nil {
		return "", err
	}
	r, err := htmlextract.Extract(html, final)
	if err != nil {
		return "", err
	}
	return strings.TrimSuffix(r.Document(), "\n"), nil
}
