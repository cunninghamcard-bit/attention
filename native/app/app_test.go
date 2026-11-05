package app

import (
	"testing"

	"github.com/egoist/mygo"
)

// Regression: mygo's default File menu took Cmd W for Close Window, so the
// key closed the window instead of the current tab.
func TestMenuLeavesCmdWToTheApp(t *testing.T) {
	var walk func(items []*mygo.MenuItem)
	walk = func(items []*mygo.MenuItem) {
		for _, it := range items {
			if it.Accelerator == "CmdOrCtrl+W" || (it.Role == mygo.RoleClose && it.Accelerator == "") {
				t.Errorf("menu item %q takes Cmd W", it.Label)
			}
			walk(it.Submenu)
		}
	}
	walk(appMenu().Items())
}
