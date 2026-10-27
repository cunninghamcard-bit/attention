// Package textui is the text tab type (RFC 0001 §5.6): any file, read-only
// in ui/editor with syntax highlighting. It is the Fallback viewer: a file
// no other type claims opens here.
package textui

import (
	"context"
	"fmt"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
)

// ID is the type's id; Kind its kind.
const (
	ID   = "text-ui"
	Kind = "text"
)

// Plugin registers the text tab type while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "fs"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var fs fscontract.FS
		if err := rctx.Use("fs", &fs); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		off := Register(ctx, fs, shellapi.Update)
		rctx.Effect(func(context.Context) error {
			off()
			cancel()
			return nil
		})
		return nil
	},
})

// Register adds the text tab type until off is called; post runs a
// function on the main thread.
func Register(ctx context.Context, fs fscontract.FS, post func(func())) (off func()) {
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
	return tabtypesapi.Register(tabtypesapi.TabType{
		ID: ID, Kind: Kind, Priority: tabtypesapi.Fallback,
		Patterns: []string{"attention-resource://file/**"},
		Body: func(c *ui.Context, p tabtypesapi.Props) {
			d := doc(p.Info.ID)
			l.Sync(d, p)
			if d.Placeholder(c) {
				return
			}
			editor.View(c, d.Ed).Key(fmt.Sprintf("ed-%d", p.Info.ID)).Grow(1).Fill()
		},
		Status: func(c *ui.Context, p tabtypesapi.Props) {
			d := doc(p.Info.ID)
			d.Cursor(c)
			d.Language(c)
		},
		Closed: func(id int) { delete(docs, id) },
		Lines:  func(id int) (int, int, bool) { return docs[id].Lines() },
	})
}
