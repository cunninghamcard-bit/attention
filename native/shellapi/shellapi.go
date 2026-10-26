// Package shellapi is the in-process side of the shell plugin (RFC 0001
// §5.4, §5.7): Go closures cannot cross rutis, so the window, the root view
// and main-thread posting live here, in the UI runtime's own memory. The
// shell rutis plugin owns the window; UI plugins inject "shell" so rutis
// orders and suspends them, then use this package.
//
// TODO(RFC §5.5): the slot registry replaces SetRoot once there is more
// than one UI plugin drawing.
package shellapi

import (
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

var (
	mu      sync.Mutex
	win     *mygo.Window
	root    func(c *ui.Context)
	pending []func()
)

// SetWindow is called by the shell plugin with its window, or nil when it
// closes it. Posts made before there was a window run on the new one.
func SetWindow(w *mygo.Window) {
	mu.Lock()
	win = w
	queued := pending
	pending = nil
	mu.Unlock()
	if w != nil {
		for _, fn := range queued {
			w.Update(fn)
		}
	}
}

// Window is the shell's window, nil when there is none.
func Window() *mygo.Window {
	mu.Lock()
	defer mu.Unlock()
	return win
}

// SetRoot installs the view the window draws; off removes it.
func SetRoot(view func(c *ui.Context)) (off func()) {
	mu.Lock()
	root = view
	w := win
	mu.Unlock()
	if w != nil {
		w.Invalidate()
	}
	return func() {
		mu.Lock()
		root = nil
		w := win
		mu.Unlock()
		if w != nil {
			w.Invalidate()
		}
	}
}

// Update runs fn on the main thread, then redraws. It is safe from any
// goroutine; all UI state is changed only through it (RFC §5.8).
func Update(fn func()) {
	mu.Lock()
	w := win
	if w == nil {
		pending = append(pending, fn)
		mu.Unlock()
		return
	}
	mu.Unlock()
	w.Update(fn)
}

// View is the window's content: the installed root, or an empty frame
// while the workspace plugin is loading or suspended.
func View(c *ui.Context) {
	mu.Lock()
	r := root
	mu.Unlock()
	if r != nil {
		r(c)
		return
	}
	t := c.Theme()
	ui.Column(c).Fill().Center().Background(t.Background).Children(func() {
		ui.Text(c, "Loading…").TextColor(t.TextMuted)
	})
}
