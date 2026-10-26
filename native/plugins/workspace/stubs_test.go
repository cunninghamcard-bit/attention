package workspace

import (
	"context"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
)

func fsStub() fscontract.FS {
	return fscontract.FS{
		Watch:   func(context.Context, string) error { return nil },
		Unwatch: func(context.Context, string) error { return nil },
	}
}

func projectStub() projectcontract.Project { return projectcontract.Project{} }
