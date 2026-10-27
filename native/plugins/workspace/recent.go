package workspace

import (
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/fileicon"
)

// maxRecentFiles is the quick switcher's recent list (getRecentFiles
// maxCount).
const maxRecentFiles = 10

// noteRecentFile keeps the recent files, newest first.
func (ws *Workspace) noteRecentFile(path string) {
	out := []string{path}
	for _, r := range ws.recentFiles {
		if r != path {
			out = append(out, r)
		}
	}
	if len(out) > maxRecentFiles {
		out = out[:maxRecentFiles]
	}
	ws.recentFiles = out
}

// fileIcon picks a lucide icon for a file name.
func fileIcon(name string) *ui.SVG { return fileicon.For(name) }
