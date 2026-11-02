package index

import (
	"context"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/project"
)

// Plugin indexes the mounts while loaded: it builds the index in the
// background, follows fs/changed and the mounts, provides "index"
// and adds its commands.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "index",
	Inject: []string{"actions", "fs", "project"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			act  *actions.Service
			fs   fsplugin.FS
			proj project.Project
		)
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		if err := rctx.Use("fs", &fs); err != nil {
			return err
		}
		if err := rctx.Use("project", &proj); err != nil {
			return err
		}
		x := New(fs, proj)
		x.act = act
		emitCtx, cancel := context.WithCancel(context.Background())
		x.OnChange = func() { _ = rctx.Emit(emitCtx, ChangedEvent) }
		rctx.Effect(func(context.Context) error { cancel(); return nil })
		rctx.Provide("index", Service{x})
		rctx.Go(x.Run)
		rctx.On(fsplugin.ChangedEvent, func(ctx context.Context, args ...any) (any, error) {
			if len(args) == 0 {
				return nil, nil
			}
			b, err := fsplugin.DecodeBatch(args[0])
			if err != nil {
				return nil, err
			}
			x.Changed(ctx, b)
			return nil, nil
		})
		rctx.On(project.MountsChangedEvent, func(ctx context.Context, _ ...any) (any, error) {
			return nil, x.Build(ctx)
		})
		for _, cmd := range x.commands() {
			off := act.Add(cmd)
			rctx.Effect(func(context.Context) error { off(); return nil })
		}
		return nil
	},
})
