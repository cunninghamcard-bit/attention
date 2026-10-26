// Command clock is an out-of-process service plugin for the P0 spike: it
// provides "clock" and calls back into the caller's process.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/arcships/rutis/go/rutis"
)

// build is set with -ldflags "-X main.build=…" to tell builds apart.
var build = "dev"

type clock struct{ rc *rutis.Ctx }

func (c *clock) Now(context.Context) (string, error) {
	return fmt.Sprintf("%s (from pid %d, build %s)", time.Now().Format(time.TimeOnly), os.Getpid(), build), nil
}

// Subscribe calls onTick n times, half a second apart, from this process.
func (c *clock) Subscribe(_ context.Context, n int, onTick func(context.Context, string) error) error {
	c.rc.Go(func(ctx context.Context) error {
		for i := range n {
			select {
			case <-time.After(500 * time.Millisecond):
			case <-ctx.Done():
				return nil
			}
			if err := onTick(ctx, fmt.Sprint(i)); err != nil {
				return err
			}
		}
		return nil
	})
	return nil
}

var plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name: "clock",
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		ctx.Provide("clock", &clock{rc: ctx})
		ctx.Effect(func(context.Context) error {
			fmt.Fprintf(os.Stderr, "[%d] clock: cleanup ran\n", os.Getpid())
			return nil
		})
		return nil
	},
})

func main() { rutis.Serve(plugin) }
