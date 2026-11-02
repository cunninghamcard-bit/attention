// Package gotoline is Go to line (attention's editor:go-to-line): a
// palette source taking "line" or "line:column" that moves the active text
// tab there, with its command.
package gotoline

import (
	"context"
	"strconv"
	"strings"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
)

// ID is the plugin's name and its palette source's.
const ID = "go-to-line"

// Plugin is Go to line while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "slots", "tabTypes", "workspace", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh  *shell.Shell
			sl  *slots.Registry
			tt  *tabtypes.Registry
			ws  *workspace.Workspace
			act *actions.Service
		)
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		if err := rctx.Use("slots", &sl); err != nil {
			return err
		}
		if err := rctx.Use("tabTypes", &tt); err != nil {
			return err
		}
		if err := rctx.Use("workspace", &ws); err != nil {
			return err
		}
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		off := Register(sh, sl, tt, ws, act)
		rctx.Effect(func(context.Context) error { off(); return nil })
		return nil
	},
})

// Source is Go to line's palette source: no rows, the line count under the
// field.
func Source(tt *tabtypes.Registry, ws *workspace.Workspace) slots.PaletteSource {
	return slots.PaletteSource{
		ID: ID, Placeholder: "Go to line (line or line:column)…",
		Submit: func(query string) bool { return submit(tt, ws, query) },
		Footer: func(c *ui.Context, _ string) {
			hint := "No text file is active"
			if _, cur, lines, ok := active(tt, ws); ok {
				hint = "Current line " + strconv.Itoa(cur) + " of " + strconv.Itoa(lines)
			}
			ui.Text(c, hint).TextColor(c.Theme().TextMuted).FontSize(12).Padding(6, 8)
		},
	}
}

// Register adds the source and its command until off is called.
func Register(sh *shell.Shell, sl *slots.Registry, tt *tabtypes.Registry, ws *workspace.Workspace, act *actions.Service) (off func()) {
	open := func() { sl.OpenPalette(ID) }
	offSrc := sl.RegisterPaletteSource(Source(tt, ws))
	offCmd := act.Add(actions.Command{ID: "editor:go-to-line", Title: "Go to line", Keys: "Ctrl G", Main: open,
		Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, sh, func() (string, error) { open(); return "", nil })
		}})
	return func() { offCmd(); offSrc() }
}

// active is the active tab and its caret line and line count, from its tab
// type; ok is false with no text tab active.
func active(ttReg *tabtypes.Registry, ws *workspace.Workspace) (info tabtypes.Info, cur, lines int, ok bool) {
	if ws == nil || ttReg == nil {
		return info, 0, 0, false
	}
	info, ok = ws.ActiveTab()
	if !ok {
		return info, 0, 0, false
	}
	tt, found := ttReg.Claim(info.Address, info.Kind)
	if !found || tt.Lines == nil {
		return info, 0, 0, false
	}
	cur, lines, ok = tt.Lines(info.ID)
	return info, cur, lines, ok
}

// parse reads "12" or "12:5".
func parse(s string) (line, col int, ok bool) {
	s = strings.TrimSpace(s)
	l, c, _ := strings.Cut(s, ":")
	line, err := strconv.Atoi(l)
	if err != nil || line < 1 {
		return 0, 0, false
	}
	col = 1
	if c != "" {
		if col, err = strconv.Atoi(c); err != nil || col < 1 {
			return 0, 0, false
		}
	}
	return line, col, true
}

// submit moves the active text tab to the query's line.
func submit(tt *tabtypes.Registry, ws *workspace.Workspace, query string) bool {
	line, col, ok := parse(query)
	info, _, _, has := active(tt, ws)
	if !ok || !has {
		return false
	}
	return ws.OpenResource(info.Address, workspace.OpenOptions{Kind: info.Kind, Nav: &workspace.Nav{Line: line, Col: col}}) == nil
}
