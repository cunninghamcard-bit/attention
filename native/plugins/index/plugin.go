package index

import (
	"context"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
)

// Plugin indexes the mounts while loaded: it builds the index in the
// background, follows fs/changed and the mounts, and adds its commands.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "index",
	Inject: []string{"actions", "fs", "project"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var fs fscontract.FS
		var project projectcontract.Project
		if err := rctx.Use("fs", &fs); err != nil {
			return err
		}
		if err := rctx.Use("project", &project); err != nil {
			return err
		}
		x := New(fs, project)
		rctx.Go(x.Run)
		rctx.On(fscontract.ChangedEvent, func(ctx context.Context, args ...any) (any, error) {
			if len(args) == 0 {
				return nil, nil
			}
			b, err := fscontract.DecodeBatch(args[0])
			if err != nil {
				return nil, err
			}
			x.Changed(ctx, b)
			return nil, nil
		})
		rctx.On(projectcontract.MountsChangedEvent, func(ctx context.Context, _ ...any) (any, error) {
			return nil, x.Build(ctx)
		})
		for _, cmd := range x.commands() {
			off := actionsapi.Register(cmd)
			rctx.Effect(func(context.Context) error { off(); return nil })
		}
		return nil
	},
})
