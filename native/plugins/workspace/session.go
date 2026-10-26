package workspace

import (
	"encoding/json"
	"os"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
)

// session is what reopens the window as it was: panes, tabs, layout.
type session struct {
	Panes     []sessionPane `json:"panes"`
	Active    int           `json:"active"`
	PanelOpen bool          `json:"panelOpen"`
	LeftWidth float32       `json:"leftWidth"`
	LeftPanel string        `json:"leftPanel,omitempty"`
	// RightOpen and RightWidth are the right dock's.
	RightOpen  bool    `json:"rightOpen,omitempty"`
	RightWidth float32 `json:"rightWidth,omitempty"`
	SplitPct   float32 `json:"splitPct"`
	// Recent files and commands: the quick switcher's and the command
	// palette's (attention keeps the latter in local storage).
	RecentFiles    []string `json:"recentFiles,omitempty"`
	RecentCommands []string `json:"recentCommands,omitempty"`
}

type sessionPane struct {
	Tabs   []string `json:"tabs"` // file paths; new tabs are not kept
	Active int      `json:"active"`
}

// loadSession reads the saved session, dropping files that are gone. It
// reads the disk and runs off the main thread.
func loadSession() (session, bool) {
	data, err := os.ReadFile(paths.SessionPath())
	if err != nil {
		return session{}, false
	}
	var s session
	if json.Unmarshal(data, &s) != nil {
		return session{}, false
	}
	var panes []sessionPane
	for _, p := range s.Panes {
		var kept sessionPane
		for i, path := range p.Tabs {
			if st, err := os.Stat(path); err == nil && !st.IsDir() {
				if i == p.Active {
					kept.Active = len(kept.Tabs)
				}
				kept.Tabs = append(kept.Tabs, path)
			}
		}
		if len(kept.Tabs) > 0 {
			panes = append(panes, kept)
		}
	}
	s.Panes = panes
	if s.Active >= len(panes) {
		s.Active = 0
	}
	return s, true
}

func (ws *Workspace) snapshot() session {
	s := session{Active: ws.active, PanelOpen: ws.panelOpen, LeftWidth: ws.leftWidth, LeftPanel: ws.leftPanel,
		RightOpen: ws.rightOpen, RightWidth: ws.rightWidth, SplitPct: ws.splitPct,
		RecentFiles: ws.recentFiles, RecentCommands: ws.recentCommands}
	if ws.restoring != nil {
		// The saved tabs are not reopened yet (the mounts are loading): keep
		// them rather than save an empty window over them.
		s.Panes = ws.restoring
		s.Active = ws.restoreActive
		return s
	}
	for _, p := range ws.panes {
		var sp sessionPane
		for i, t := range p.tabs {
			if t.kind == kindEmpty {
				continue
			}
			if i == p.active {
				sp.Active = len(sp.Tabs)
			}
			sp.Tabs = append(sp.Tabs, t.path)
		}
		s.Panes = append(s.Panes, sp)
	}
	return s
}

func saveSession(s session) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return paths.WriteFileAtomic(paths.SessionPath(), data)
}

// restoreLayout applies the saved layout; the tabs reopen once the mounts
// are known (setMounts).
func (ws *Workspace) restoreLayout(s session) {
	if s.LeftWidth >= 120 {
		ws.leftWidth = s.LeftWidth
	}
	if s.RightWidth >= 120 {
		ws.rightWidth = s.RightWidth
	}
	ws.leftPanel, ws.rightOpen = s.LeftPanel, s.RightOpen
	if s.SplitPct > 10 && s.SplitPct < 90 {
		ws.splitPct = s.SplitPct
	}
	ws.panelOpen = s.PanelOpen || len(s.Panes) == 0
	ws.recentFiles, ws.recentCommands = s.RecentFiles, s.RecentCommands
	ws.restoring = s.Panes
	ws.restoreActive = s.Active
	if ws.mountsLoaded {
		ws.reopen(ws.restoring)
		ws.restoring = nil
	}
}

func (ws *Workspace) reopen(panes []sessionPane) {
	for i, sp := range panes {
		if i > 1 {
			break // at most two panes
		}
		for len(ws.panes) <= i {
			ws.panes = append(ws.panes, &pane{})
		}
		ws.active = i
		for _, path := range sp.Tabs {
			ws.open(path, nil)
		}
		ws.panes[i].active = min(sp.Active, max(0, len(ws.panes[i].tabs)-1))
	}
	ws.active = max(0, min(ws.restoreActive, len(ws.panes)-1))
	ws.changed()
}
