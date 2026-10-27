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

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// ID is the plugin's name and its palette source's.
const ID = "go-to-line"

// active is the active tab and its caret line and line count, from its tab
// type; ok is false with no text tab active.
func active() (info tabtypesapi.Info, cur, lines int, ok bool) {
	ws := workspaceapi.Get()
	if ws == nil {
		return info, 0, 0, false
	}
	info, ok = ws.ActiveTab()
	if !ok {
		return info, 0, 0, false
	}
	tt, found := tabtypesapi.Claim(info.Address, info.Kind)
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
func submit(query string) bool {
	line, col, ok := parse(query)
	info, _, _, has := active()
	if !ok || !has {
		return false
	}
	ws := workspaceapi.Get()
	return ws.OpenResource(info.Address, workspaceapi.OpenOptions{Kind: info.Kind, Nav: &workspaceapi.Nav{Line: line, Col: col}}) == nil
}

// Source is Go to line's palette source: no rows, the line count under the
// field.
func Source() slotsapi.PaletteSource {
	return slotsapi.PaletteSource{
		ID: ID, Placeholder: "Go to line (line or line:column)…",
		Submit: submit,
		Footer: func(c *ui.Context, _ string) {
			hint := "No text file is active"
			if _, cur, lines, ok := active(); ok {
				hint = "Current line " + strconv.Itoa(cur) + " of " + strconv.Itoa(lines)
			}
			ui.Text(c, hint).TextColor(c.Theme().TextMuted).FontSize(12).Padding(6, 8)
		},
	}
}

func open() { slotsapi.OpenPalette(ID) }

// Register adds the source and its command until off is called.
func Register() (off func()) {
	offSrc := slotsapi.RegisterPaletteSource(Source())
	offCmd := actionsapi.Register(actionsapi.Command{ID: "editor:go-to-line", Title: "Go to line", Keys: "Ctrl G", Main: open,
		Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			return shellapi.OnMain(ctx, func() (string, error) { open(); return "", nil })
		}})
	return func() { offCmd(); offSrc() }
}

// Plugin is Go to line while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "actions", "workspace"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		off := Register()
		rctx.Effect(func(context.Context) error { off(); return nil })
		return nil
	},
})
