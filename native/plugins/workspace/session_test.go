package workspace

import "testing"

func TestSnapshotKeepsTabsStillToRestore(t *testing.T) {
	ws := newWorkspace(t.Context(), fsStub(), projectStub())
	ws.restoreLayout(session{Panes: []sessionPane{{Tabs: []string{"/x/a.md"}}}, PanelOpen: true})
	s := ws.snapshot()
	if len(s.Panes) != 1 || len(s.Panes[0].Tabs) != 1 || s.Panes[0].Tabs[0] != "/x/a.md" {
		t.Fatalf("snapshot before the mounts loaded = %+v, want the pending tabs", s)
	}
}
