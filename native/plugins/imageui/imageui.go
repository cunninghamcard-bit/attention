// Package imageui is the image tab type (RFC 0001 §5.6).
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

	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
)

const (
	ID       = "image-ui"
	Kind     = "image"
	MaxBytes = 50 << 20
)

// Plugin registers the image tab type while loaded.
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

type doc struct {
	img     ui.ImageSource
	err     string
	gone    bool
	loaded  bool
	loading bool
	version int
}

// Register adds the image tab type until off is called.
func Register(ctx context.Context, fs fsplugin.FS, tt *tabtypes.Registry, post func(func())) (off func()) {
	docs := map[int]*doc{}
	load := func(d *doc, p tabtypes.Props) {
		d.loading, d.loaded, d.version = true, true, p.Info.Version
		path := p.Info.Path
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
					d.gone = true
				case err != nil:
					d.err = err.Error()
				default:
					d.err, d.gone, d.img = "", false, img
				}
			})
		}()
	}
	return tt.Register(tabtypes.TabType{
		ID: ID, Kind: Kind, Priority: tabtypes.Builtin,
		Patterns: []string{"*.png", "*.jpg", "*.jpeg", "*.gif", "*.bmp", "*.webp", "*.svg"},
		Body: func(c *ui.Context, p tabtypes.Props) {
			d, ok := docs[p.Info.ID]
			if !ok {
				d = &doc{}
				docs[p.Info.ID] = d
			}
			if !d.loading && !p.Info.Pending && (!d.loaded || d.version != p.Info.Version) {
				load(d, p)
			}
			switch {
			case d.err != "":
				textdoc.Centered(c, d.err)
			case d.img == nil && d.gone:
				textdoc.Centered(c, "This file does not exist.")
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
		Status: func(c *ui.Context, _ tabtypes.Props) {
			ui.Text(c, "Image").FontSize(12).TextColor(c.Theme().TextMuted)
		},
		Closed: func(id int) { delete(docs, id) },
	})
}

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
