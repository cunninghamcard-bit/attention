package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshotKeepsTabsStillToRestore(t *testing.T) {
	ws := newWorkspace(t.Context(), fsStub(), projectStub())
	ws.restoreLayout(session{Panes: []sessionPane{{Tabs: []string{"/x/a.md"}}}, PanelOpen: true})
	s := ws.snapshot()
	if s.Main == nil || len(s.Main.Children) != 1 || len(s.Main.Children[0].Tabs) != 1 || s.Main.Children[0].Tabs[0] != "/x/a.md" {
		t.Fatalf("snapshot before the mounts loaded = %+v, want the pending tabs", s)
	}
}

func TestADeletedFileReopensMissingWhileItsDirectoryIsThere(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.md")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]bool{
		file:                             true,
		filepath.Join(dir, "gone.md"):    true,
		filepath.Join(dir, "no/such.md"): false,
		dir:                              false,
	} {
		if keepTab(path) != want {
			t.Errorf("keepTab(%s) = %v", path, !want)
		}
	}
}
