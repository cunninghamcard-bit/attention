// Package markdownui is the markdown tab type (RFC 0001 §5.6): the
// ui/markdown reading view, with the source in ui/editor a toggle away
// (Ctrl E, attention's markdown:toggle-preview). A navigation to a line
// shows the source, where the passage is.
package markdownui

import (
	"context"
	"fmt"
	neturl "net/url"
	"path/filepath"
	"strings"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// ID is the type's id; Kind its kind.
const (
	ID   = "markdown-ui"
	Kind = "markdown"
)

type doc struct {
	textdoc.Doc
	source bool // the source instead of the reading view
	md     markdown.Options
	dir    string // md's image directory
}

// Viewer is the markdown tab type's state, on the main thread only.
type Viewer struct {
	l    *textdoc.Loader
	docs map[int]*doc
}

func (v *Viewer) doc(p tabtypesapi.Props) *doc {
	d, ok := v.docs[p.Info.ID]
	if !ok {
		d = &doc{}
		d.OnNav = func() { d.source = true } // a passage is shown in the source
		v.docs[p.Info.ID] = d
	}
	if dir := filepath.Dir(p.Info.Path); dir != d.dir {
		from := p.Info.Path
		d.dir = dir
		d.md.OnLink = func(url string) { followLink(from, url) }
		d.md.LoadImage = markdown.FileImages(dir)
	}
	return d
}

// Toggle switches tab id between the reading view and the source.
func (v *Viewer) Toggle(id int) {
	if d, ok := v.docs[id]; ok {
		d.source = !d.source
	}
}

// Source reports whether tab id shows its source.
func (v *Viewer) Source(id int) bool { d, ok := v.docs[id]; return ok && d.source }

// Selected is tab id's selected text ("" for none).
func (v *Viewer) Selected(id int) string {
	d, ok := v.docs[id]
	if !ok || d.Ed == nil {
		return ""
	}
	sels := d.Ed.Selections()
	if len(sels) == 0 {
		return ""
	}
	from, to := min(sels[0].Anchor, sels[0].Head), max(sels[0].Anchor, sels[0].Head)
	return d.Ed.Buffer.String()[from:to]
}

func (v *Viewer) body(c *ui.Context, p tabtypesapi.Props) {
	d := v.doc(p)
	v.l.Sync(&d.Doc, p)
	if p.Info.Focused && c.Shortcut(ui.Cmd, ui.KeyE) {
		d.source = !d.source
	}
	if d.Placeholder(c) {
		return
	}
	if !d.source {
		ui.Scroll(c).Key(fmt.Sprintf("md-%d", p.Info.ID)).Grow(1).Fill().Children(func() {
			ui.Column(c).PaddingX(48).PaddingY(32).MaxWidth(860).FillWidth().Children(func() {
				markdown.View(c, d.Ed.Buffer.String(), &d.md)
			})
		})
		return
	}
	editor.View(c, d.Ed).Key(fmt.Sprintf("ed-%d", p.Info.ID)).Grow(1).Fill()
}

func (v *Viewer) status(c *ui.Context, p tabtypesapi.Props) {
	d := v.doc(p)
	if d.source {
		d.Cursor(c)
	}
	d.Language(c)
}

// actions is the view header's mode button, as MarkdownView's
// (updateButtons): it names the view it switches to.
func (v *Viewer) actions(c *ui.Context, p tabtypesapi.Props) {
	d := v.doc(p)
	label, icon := "Switch to source view", lucide.Code()
	if d.source {
		label, icon = "Switch to reading view", lucide.BookOpen()
	}
	omgui.Button(c, omgui.ButtonProps{Label: label, Icon: icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
		OnClick: func() { d.source = !d.source }}).Tooltip(label + " (Ctrl E)")
}

// menu is More options' Toggle reading view (MarkdownView.onPaneMenu).
func (v *Viewer) menu(id int) []tabtypesapi.MenuItem {
	d, ok := v.docs[id]
	if !ok {
		return nil
	}
	return []tabtypesapi.MenuItem{{Title: "Toggle reading view", Icon: lucide.BookOpen(), Checked: !d.source, Run: func() { d.source = !d.source }}}
}

// Register adds the markdown tab type until off is called; post runs a
// function on the main thread.
func Register(ctx context.Context, fs fscontract.FS, post func(func())) (v *Viewer, off func()) {
	v = &Viewer{l: &textdoc.Loader{Ctx: ctx, FS: fs, Post: post}, docs: map[int]*doc{}}
	off = tabtypesapi.Register(tabtypesapi.TabType{
		ID: ID, Kind: Kind, Priority: tabtypesapi.Builtin,
		Patterns: []string{"*.md", "*.markdown", "*.mdx"},
		Body:     v.body,
		Status:   v.status,
		Actions:  v.actions,
		Menu:     v.menu,
		Closed:   func(id int) { delete(v.docs, id) },
		Lines: func(id int) (int, int, bool) {
			if d, ok := v.docs[id]; ok {
				return d.Lines()
			}
			return 0, 0, false
		},
	})
	return v, off
}

// Plugin registers the markdown tab type and its toggle command while
// loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "fs", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var fs fscontract.FS
		if err := rctx.Use("fs", &fs); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		v, off := Register(ctx, fs, shellapi.Update)
		offCmd := actionsapi.Register(actionsapi.Command{ID: "markdown:toggle-preview", Title: "Toggle reading view", Keys: "Ctrl E",
			Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
				return shellapi.OnMain(ctx, func() (string, error) {
					if ws := workspaceapi.Get(); ws != nil {
						if tab, ok := ws.ActiveTab(); ok && tab.Kind == Kind {
							v.Toggle(tab.ID)
						}
					}
					return "", nil
				})
			}})
		rctx.Effect(func(context.Context) error {
			offCmd()
			off()
			cancel()
			return nil
		})
		return nil
	},
})

// followLink opens a markdown link: a relative path or file: URL as a
// file, a #fragment does nothing here, other schemes open outside.
func followLink(from, url string) {
	if strings.HasPrefix(url, "#") {
		return
	}
	if strings.Contains(url, "://") && !strings.HasPrefix(url, "file://") {
		go func() { _ = mygo.Shell.OpenExternal(url) }()
		return
	}
	p := url
	if strings.HasPrefix(url, "file:") {
		u, err := neturl.Parse(url)
		if err != nil {
			return
		}
		p = u.Path
	} else if i := strings.IndexAny(p, "#?"); i >= 0 {
		p = p[:i]
	}
	if decoded, err := neturl.PathUnescape(p); err == nil {
		p = decoded
	}
	if !filepath.IsAbs(p) {
		p = filepath.Join(filepath.Dir(from), p)
	}
	if ws := workspaceapi.Get(); ws != nil {
		ws.Open(filepath.Clean(p), nil, false)
	}
}
