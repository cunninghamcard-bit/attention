// Package webindex is the web-index plugin (RFC 0001 §5.6, roadmap P3):
// each page the web viewer finished loading goes to the index, so notes
// and web pages citing the same URL see each other in their backlinks;
// clearing the web history takes the pages out again. The web viewer does
// not depend on the index: a profile with no index loads no web-index.
package webindex

import (
	"context"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/plugins/index"
	"github.com/cunninghamcard-bit/attention/native/plugins/web"
	"github.com/cunninghamcard-bit/attention/native/plugins/webhistory"
)

// ID is the plugin's name.
const ID = "web-index"

// Plugin submits the loaded pages while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"index", "web", "web-history"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var idx index.Index
		if err := rctx.Use("index", &idx); err != nil {
			return err
		}
		rctx.On(web.PageLoadedEvent, func(ctx context.Context, args ...any) (any, error) {
			if len(args) == 0 {
				return nil, nil
			}
			p, err := web.DecodePage(args[0])
			if err != nil {
				return nil, err
			}
			return nil, idx.SubmitPage(ctx, index.Page{URL: p.URL, Title: p.Title, Markdown: p.Markdown})
		})
		rctx.On(webhistory.ClearedEvent, func(ctx context.Context, _ ...any) (any, error) {
			return nil, idx.RemovePages(ctx, nil)
		})
		return nil
	},
})
