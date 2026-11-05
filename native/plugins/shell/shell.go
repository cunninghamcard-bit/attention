// Package shell is the shell plugin (RFC 0001 §5.4, §5.7): the window, root
// view, and main-thread posting.
package shell

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// Plugin opens the window when it loads and closes it when it unloads.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name: "shell",
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		sh := New()
		var unloading atomic.Bool
		background := os.Getenv("ATTENTION_HIDDEN") != ""
		w := mygo.NewWindow(mygo.WindowOptions{
			Title:                "attention",
			Width:                1280,
			Height:               820,
			TitleBarStyle:        mygo.TitleBarHidden,
			TrafficLightPosition: &mygo.Point{X: 19, Y: 9},
			TitleBarHeight:       30,
			Content:              ui.View(sh.View),
			Hidden:               background,
		})
		if background {
			w.ShowInactive()
			w.Minimize()
		}
		w.OnClose(func(e *mygo.CloseEvent) {
			if !unloading.Load() {
				e.PreventDefault()
				mygo.App.Quit()
			}
		})
		sh.SetWindow(w)
		ctx.Provide("shell", sh)
		ctx.Effect(func(context.Context) error {
			unloading.Store(true)
			sh.SetWindow(nil)
			w.Destroy()
			return nil
		})
		return nil
	},
})

// Shell owns the window, root view, and main-thread queue.
type Shell struct {
	mu      sync.Mutex
	win     *mygo.Window
	root    func(c *ui.Context)
	pending []func()
}

// New creates a Shell instance.
func New() *Shell { return &Shell{} }

// Ready reports whether the window is up.
func (s *Shell) Ready(context.Context) (bool, error) { return s.Window() != nil, nil }

// SetWindow sets the window, or nil when closed. Posts made before there was
// a window run on the new one.
func (s *Shell) SetWindow(w *mygo.Window) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.win = w
	queued := s.pending
	s.pending = nil
	s.mu.Unlock()
	if w != nil {
		for _, fn := range queued {
			w.Update(fn)
		}
	}
}

// Window is the shell's window, nil when there is none.
func (s *Shell) Window() *mygo.Window {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.win
}

// Invalidate marks the window for redraw when open.
func (s *Shell) Invalidate() {
	if w := s.Window(); w != nil {
		w.Invalidate()
	}
}

// SetRoot installs the view the window draws; off removes it.
func (s *Shell) SetRoot(view func(c *ui.Context)) (off func()) {
	if s == nil {
		return func() {}
	}
	s.mu.Lock()
	s.root = view
	w := s.win
	s.mu.Unlock()
	if w != nil {
		w.Invalidate()
	}
	return func() {
		s.mu.Lock()
		s.root = nil
		w := s.win
		s.mu.Unlock()
		if w != nil {
			w.Invalidate()
		}
	}
}

// Update runs fn on the main thread, then redraws.
func (s *Shell) Update(fn func()) {
	if s == nil {
		fn()
		return
	}
	s.mu.Lock()
	w := s.win
	if w == nil {
		s.pending = append(s.pending, fn)
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	w.Update(fn)
}

// View is the window's content.
func (s *Shell) View(c *ui.Context) {
	s.mu.Lock()
	r := s.root
	s.mu.Unlock()
	if r != nil {
		r(c)
		return
	}
	t := c.Theme()
	ui.Column(c).Fill().Center().Background(t.Background).Children(func() {
		ui.Text(c, "Loading…").TextColor(t.TextMuted)
	})
}

// OnMain runs fn on the main thread and waits for it.
func OnMain[T any](ctx context.Context, s *Shell, fn func() (T, error)) (T, error) {
	type result struct {
		v   T
		err error
	}
	if s.Window() == nil {
		var zero T
		return zero, fmt.Errorf("the window is closed")
	}
	done := make(chan result, 1)
	s.Update(func() {
		v, err := fn()
		done <- result{v, err}
	})
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	select {
	case r := <-done:
		return r.v, r.err
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	case <-timer.C:
		var zero T
		return zero, fmt.Errorf("the window did not respond")
	}
}
