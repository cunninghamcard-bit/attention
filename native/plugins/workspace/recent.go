package workspace

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
