package fileresource

import (
	"context"
	"testing"
	"time"

	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
)

func TestOpenDirectoryEmitsErrorOnly(t *testing.T) {
	fs := fsplugin.FS{
		Watch:   func(context.Context, string) error { return nil },
		Unwatch: func(context.Context, string) error { return nil },
		Stat: func(_ context.Context, path string) (fsplugin.Entry, error) {
			return fsplugin.Entry{Path: path, Dir: true}, nil
		},
	}
	mounts := func(context.Context) ([]projectplugin.Mount, error) { return nil, nil }
	p := New(t.Context(), fs, mounts)

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	type frame struct {
		val any
		err error
	}
	frames := make(chan frame, 4)
	go p.Open(ctx, fsplugin.AbsoluteAddress("/tmp/dir"), func(v any, err error) {
		frames <- frame{val: v, err: err}
	})

	select {
	case f := <-frames:
		if f.err == nil || f.val != nil {
			t.Fatalf("first frame = (%v, %v), want directory error", f.val, f.err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for error frame")
	}

	p.Changed(fsplugin.Batch{Changes: []fsplugin.Change{{Path: "/tmp/dir"}}})
	select {
	case f := <-frames:
		t.Fatalf("unexpected extra frame after directory error: (%v, %v)", f.val, f.err)
	case <-time.After(30 * time.Millisecond):
	}
}
