// Package imageui is the image tab type (RFC 0001 §5.6): bitmaps and SVG,
// fitted to the tab.
package imageui

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
)

// ID is the type's id; Kind its kind.
const (
	ID   = "image-ui"
	Kind = "image"
)

// MaxBytes is the largest image read.
const MaxBytes = 50 << 20

type doc struct {
	img     ui.ImageSource
	err     string
	loaded  bool
	loading bool
	version int
}

// Register adds the image tab type until off is called; post runs a
// function on the main thread.
func Register(ctx context.Context, fs fscontract.FS, post func(func())) (off func()) {
	docs := map[int]*doc{}
	load := func(d *doc, p tabtypesapi.Props) {
		d.loading, d.loaded, d.version = true, true, p.Info.Version
		path, missing := p.Info.Path, p.MarkMissing
		start := time.Now()
		go func() {
			var img ui.ImageSource
			data, err := fs.ReadBytes(ctx, path, MaxBytes)
			if err == nil {
				if strings.EqualFold(filepath.Ext(path), ".svg") {
					img, err = ui.ParseSVG(data)
				} else {
					img, err = ui.DecodeBitmap(data)
				}
			}
			post(func() {
				debugf("tab: loaded %s in %s", path, time.Since(start))
				d.loading = false
				switch {
				case errors.Is(err, os.ErrNotExist):
					if missing != nil {
						missing()
					}
				case err != nil:
					d.err = err.Error()
				default:
					d.err, d.img = "", img
				}
			})
		}()
	}
	return tabtypesapi.Register(tabtypesapi.TabType{
		ID: ID, Kind: Kind, Priority: tabtypesapi.Builtin,
		Patterns: []string{"*.png", "*.jpg", "*.jpeg", "*.gif", "*.bmp", "*.webp", "*.svg"},
		Body: func(c *ui.Context, p tabtypesapi.Props) {
			d, ok := docs[p.Info.ID]
			if !ok {
				d = &doc{}
				docs[p.Info.ID] = d
			}
			if !d.loading && (!d.loaded || d.version != p.Info.Version) {
				load(d, p)
			}
			switch {
			case d.err != "":
				textdoc.Centered(c, d.err)
			case d.img == nil:
				textdoc.Centered(c, "Loading…")
			default:
				ui.Scroll(c).Grow(1).Fill().Children(func() {
					ui.Column(c).Padding(16).Center().FillWidth().Children(func() {
						ui.Image(c, d.img).Fit(ui.Contain).MaxWidthPercent(100)
					})
				})
			}
		},
		Status: func(c *ui.Context, _ tabtypesapi.Props) {
			ui.Text(c, "Image").FontSize(12).TextColor(c.Theme().TextMuted)
		},
		Closed: func(id int) { delete(docs, id) },
	})
}

// Plugin registers the image tab type while loaded.
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

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
