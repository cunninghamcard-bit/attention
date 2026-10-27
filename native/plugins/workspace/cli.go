package workspace

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/clipath"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// recents, tab:open and workspace are the TS CLI's
// (apps/web/app/cli/commands/navigation.ts). Everything that reads the
// workspace hops to the main thread, as tabs does.

// cliRecents is `recents [total]`: the files opened last, newest first.
func (ws *Workspace) cliRecents(ctx context.Context, a actionsapi.Args) (string, error) {
	return shellapi.OnMain(ctx, func() (string, error) {
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
func (ws *Workspace) cliTabOpen(ctx context.Context, a actionsapi.Args) (string, error) {
	var path string
	if file := a.Params["file"]; file != "" {
		mounts, err := ws.project.Mounts(ctx)
		if err != nil {
			return "", err
		}
		path, err = clipath.Link(ctx, ws.project.Files, mounts, file, a.Cwd)
		if err != nil {
			return "", err
		}
	}
	return shellapi.OnMain(ctx, func() (string, error) {
		if g := a.Params["group"]; g != "" {
			p := ws.findTabGroup(g)
			if p == nil {
				return "", fmt.Errorf("Tab group %q not found. Use \"workspace ids=true\" to list tab group IDs.", g)
			}
			ws.activeGroup = p
		}
		if path != "" {
			if _, err := ws.openAddress(ws.addressOf(path), path, workspaceapi.OpenOptions{NewTab: true}); err != nil {
				return "", err
			}
			return "Opened: " + a.Params["file"], nil
		}
		if view := a.Params["view"]; view != "" {
			if _, err := ws.openTab(view, workspaceapi.OpenOptions{NewTab: true}); err != nil {
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
	for _, g := range ws.groups() {
		if strconv.Itoa(g.id) == id {
			return g
		}
	}
	return nil
}

// cliWorkspace is `workspace [ids]`: the center's split/tabs tree.
func (ws *Workspace) cliWorkspace(ctx context.Context, a actionsapi.Args) (string, error) {
	return shellapi.OnMain(ctx, func() (string, error) {
		ids := a.Has("ids")
		children := make([]asciiNode, 0, len(ws.root.children))
		for _, c := range ws.root.children {
			children = append(children, ws.mapAscii(c, ids))
		}
		return formatAsciiTreeWithRoot("main", children), nil
	})
}

// mapAscii is n as the TS CLI's workspace tree: a split as
// "split:<direction>", a tab group as "tabs", a tab as the tabs command
// shows it.
func (ws *Workspace) mapAscii(n *node, ids bool) asciiNode {
	if n.group != nil {
		label := "tabs"
		if ids {
			label += " (" + strconv.Itoa(n.group.id) + ")"
		}
		children := make([]asciiNode, 0, len(n.group.tabs))
		for _, t := range n.group.tabs {
			tl := "[" + t.viewType() + "] " + t.displayText()
			if ids {
				tl += " (" + strconv.Itoa(t.id) + ")"
			}
			children = append(children, asciiNode{label: tl})
		}
		return asciiNode{label: label, children: children}
	}
	label := "split:" + string(n.dir)
	children := make([]asciiNode, 0, len(n.children))
	for _, c := range n.children {
		children = append(children, ws.mapAscii(c, ids))
	}
	return asciiNode{label: label, children: children}
}

// asciiNode is one row of formatAsciiTree (apps/web/app/cli/Cli.ts).
type asciiNode struct {
	label    string
	children []asciiNode
}

func formatAsciiTreeWithRoot(root string, nodes []asciiNode) string {
	lines := []string{root}
	if len(nodes) > 0 {
		lines = append(lines, formatAsciiTree(nodes, ""))
	}
	return strings.Join(lines, "\n")
}

func formatAsciiTree(nodes []asciiNode, indent string) string {
	var lines []string
	for i, n := range nodes {
		last := i == len(nodes)-1
		branch, next := "├── ", "│   "
		if last {
			branch, next = "└── ", "    "
		}
		lines = append(lines, indent+branch+n.label)
		if len(n.children) > 0 {
			lines = append(lines, formatAsciiTree(n.children, indent+next))
		}
	}
	return strings.Join(lines, "\n")
}
