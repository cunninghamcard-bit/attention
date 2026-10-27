// Package lifecycle is the runtime's quit: the UI runtime sets how this
// process ends (mygo's quit with a window, asking rutis-host to stop
// headless), and the quit command calls it, whichever profile runs.
package lifecycle

import "sync"

var (
	mu   sync.Mutex
	quit func()
)

// SetQuit sets what Quit does.
func SetQuit(fn func()) {
	mu.Lock()
	quit = fn
	mu.Unlock()
}

// Quit ends the app as closing its window does; false when no runtime set
// how (a test, or a plugin served elsewhere).
func Quit() bool {
	mu.Lock()
	fn := quit
	mu.Unlock()
	if fn == nil {
		return false
	}
	fn()
	return true
}
