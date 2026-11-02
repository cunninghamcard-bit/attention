// Package textui is the text tab type (RFC 0001 §5.6).
package textui

import (
	"context"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
)

const (
	ID   = "text-ui"
	Kind = "text"
)

// Plugin registers the text tab type while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "tabTypes", "fs"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var sh *shell.Shell
		var tt *tabtypes.Registry
		var fs fsplugin.FS
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		if err := rctx.Use("tabTypes", &tt); err != nil {
			return err
		}
		if err := rctx.Use("fs", &fs); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		off := Register(ctx, fs, tt, sh.Update)
		rctx.Effect(func(context.Context) error {
			off()
			cancel()
			return nil
		})
		return nil
	},
})

// Register adds the text tab type until off is called.
func Register(ctx context.Context, fs fsplugin.FS, tt *tabtypes.Registry, post func(func())) (off func()) {
	l := &textdoc.Loader{Ctx: ctx, FS: fs, Post: post}
	docs := map[int]*textdoc.Doc{}
	doc := func(id int) *textdoc.Doc {
		d, ok := docs[id]
		if !ok {
			d = &textdoc.Doc{}
			docs[id] = d
		}
		return d
	}
	return tt.Register(tabtypes.TabType{
		ID: ID, Kind: Kind, Priority: tabtypes.Fallback,
		Patterns: []string{"attention-resource://file/**"},
		Body: func(c *ui.Context, p tabtypes.Props) {
			d := doc(p.Info.ID)
			l.Sync(d, p)
			if d.Placeholder(c) {
				return
			}
			d.View(c, p.Info.ID)
		},
		Status: func(c *ui.Context, p tabtypes.Props) {
			d := doc(p.Info.ID)
			d.Cursor(c)
			d.Language(c)
		},
		Closed: func(id int) { delete(docs, id) },
		Lines:  func(id int) (int, int, bool) { return docs[id].Lines() },
	})
}
