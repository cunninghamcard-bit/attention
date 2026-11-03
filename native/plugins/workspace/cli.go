package workspace

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/cunninghamcard-bit/attention/native/internal/clifmt"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
)

// recents, tab:open and workspace are the TS CLI's
// (apps/web/app/cli/commands/navigation.ts). Everything that reads the
// workspace hops to the main thread, as tabs does.

// cliRecents is `recents [total]`: the files opened last, newest first.
func (ws *Workspace) cliRecents(ctx context.Context, a actions.Args) (string, error) {
	return shell.OnMain(ctx, ws.sh, func() (string, error) {
		files := ws.recentFiles
		if a.Has("total") {
			return strconv.Itoa(len(files)), nil
		}
		if len(files) == 0 {
			return "No recent files.", nil
		}
		lines := make([]string, len(files))
		for i, p := range files {
			lines[i] = ws.display(p)
		}
		return strings.Join(lines, "\n"), nil
	})
}

// cliTabOpen is `tab:open [group=<id>] [file=<path>] [view=<type>]`: a new
// tab, then a file (openAddress) or a page of kind (openTab).
func (ws *Workspace) cliTabOpen(ctx context.Context, a actions.Args) (string, error) {
	var path string
	if file := a.Params["file"]; file != "" {
		mounts, err := ws.project.Mounts(ctx)
		if err != nil {
			return "", err
		}
		path, err = projectplugin.ResolveLink(ctx, ws.project.Files, mounts, file, a.Cwd)
		if err != nil {
			return "", err
		}
	}
	return shell.OnMain(ctx, ws.sh, func() (string, error) {
		if g := a.Params["group"]; g != "" {
			p := ws.findTabGroup(g)
			if p == nil {
				return "", fmt.Errorf("Tab group %q not found. Use \"workspace ids=true\" to list tab group IDs.", g)
			}
			ws.activeGroup = p
		}
		if path != "" {
			if _, err := ws.openAddress(ws.addressOf(path), path, OpenOptions{NewTab: true}); err != nil {
				return "", err
			}
			return "Opened: " + a.Params["file"], nil
		}
		if view := a.Params["view"]; view != "" {
			if _, err := ws.openTab(view, OpenOptions{NewTab: true}); err != nil {
				return "", err
			}
			return "Opened view: " + view, nil
		}
		ws.newTab()
		return "Opened new tab", nil
	})
}

// findTabGroup is the pane whose id is id, or nil. Only tab groups match,
// as the TS CLI's findTabGroup (a split id does not).
func (ws *Workspace) findTabGroup(id string) *pane {
	for _, g := range ws.allGroups() {
		if strconv.Itoa(g.id) == id {
			return g
		}
	}
	return nil
}

// cliWorkspace is `workspace [ids]`: the list's items, a tab as a tab
// group of one, a split as its split/tabs tree.
func (ws *Workspace) cliWorkspace(ctx context.Context, a actions.Args) (string, error) {
	return shell.OnMain(ctx, ws.sh, func() (string, error) {
		ids := a.Has("ids")
		var children []clifmt.Node
		for _, it := range ws.shownItems() {
			n := it
			if len(it.children) == 1 {
				n = it.children[0]
			}
			children = append(children, ws.mapAscii(n, ids))
		}
		return clifmt.TreeWithRoot("main", children), nil
	})
}

// mapAscii is n as the TS CLI's workspace tree: a split as
// "split:<direction>", a tab group as "tabs", a tab as the tabs command
// shows it.
func (ws *Workspace) mapAscii(n *node, ids bool) clifmt.Node {
	if n.group != nil {
		label := "tabs"
		if ids {
			label += " (" + strconv.Itoa(n.group.id) + ")"
		}
		children := make([]clifmt.Node, 0, len(n.group.tabs))
		for _, t := range n.group.tabs {
			tl := "[" + t.viewType() + "] " + t.displayText()
			if ids {
				tl += " (" + strconv.Itoa(t.id) + ")"
			}
			children = append(children, clifmt.Node{Label: tl})
		}
		return clifmt.Node{Label: label, Children: children}
	}
	label := "split:" + string(n.dir)
	children := make([]clifmt.Node, 0, len(n.children))
	for _, c := range n.children {
		children = append(children, ws.mapAscii(c, ids))
	}
	return clifmt.Node{Label: label, Children: children}
}
