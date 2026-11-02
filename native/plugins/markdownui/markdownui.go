// Package markdownui is the markdown tab type (RFC 0001 §5.6, port of
// apps/web/builtin/MarkdownView.ts).
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

	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
)

const (
	ID   = "markdown-ui"
	Kind = "markdown"
)

// Plugin registers the markdown tab type and its toggle command while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "tabTypes", "workspace", "fs", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var sh *shell.Shell
		var tt *tabtypes.Registry
		var ws Navigator
		var fs fsplugin.FS
		var act *actions.Service
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		if err := rctx.Use("tabTypes", &tt); err != nil {
			return err
		}
		if err := rctx.Use("workspace", &ws); err != nil {
			return err
		}
		if err := rctx.Use("fs", &fs); err != nil {
			return err
		}
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		_, off := Register(ctx, fs, sh, act, tt, ws, sh.Update)
		rctx.Effect(func(context.Context) error {
			off()
			cancel()
			return nil
		})
		return nil
	},
})

// Navigator is the workspace interface used by the markdown viewer.
type Navigator interface {
	ActiveTab() (tabtypes.Info, bool)
	Open(path string, nav *tabtypes.Nav, newTab bool)
	ResolveLink(ctx context.Context, link, dir string) (string, error)
}

type doc struct {
	textdoc.Doc
	source    bool
	md        markdown.Options
	dir       string
	raw, view string
}

// Viewer is the markdown tab type's state, on the main thread only.
type Viewer struct {
	l    *textdoc.Loader
	ws   Navigator
	docs map[int]*doc
}

// Register adds the markdown tab type until off is called.
func Register(ctx context.Context, fs fsplugin.FS, sh *shell.Shell, act *actions.Service, tt *tabtypes.Registry, ws Navigator, post func(func())) (v *Viewer, off func()) {
	v = &Viewer{l: &textdoc.Loader{Ctx: ctx, FS: fs, Post: post}, ws: ws, docs: map[int]*doc{}}
	toggle := func() {
		if v.ws != nil {
			if tab, ok := v.ws.ActiveTab(); ok && tab.Kind == Kind {
				v.Toggle(tab.ID)
			}
		}
	}
	offCmd := act.Add(actions.Command{ID: "markdown:toggle-preview", Title: "Toggle reading view", Keys: "Ctrl E", Main: toggle,
		Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, sh, func() (string, error) { toggle(); return "", nil })
		}})
	offType := tt.Register(tabtypes.TabType{
		ID: ID, Kind: Kind, Priority: tabtypes.Builtin,
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
	return v, func() { offCmd(); offType() }
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

func (v *Viewer) doc(p tabtypes.Props) *doc {
	d, ok := v.docs[p.Info.ID]
	if !ok {
		d = &doc{}
		d.OnNav = func() { d.source = true }
		v.docs[p.Info.ID] = d
	}
	if dir := filepath.Dir(p.Info.Path); dir != d.dir {
		from := p.Info.Path
		d.dir = dir
		d.md.OnLink = func(url string) { v.followLink(from, url) }
		d.md.LoadImage = v.loadImage(from)
	}
	return d
}

func (v *Viewer) body(c *ui.Context, p tabtypes.Props) {
	d := v.doc(p)
	v.l.Sync(&d.Doc, p)
	if d.Placeholder(c) {
		return
	}
	if !d.source {
		ui.Scroll(c).Key(fmt.Sprintf("md-%d", p.Info.ID)).Grow(1).Fill().Children(func() {
			ui.Column(c).PaddingX(48).PaddingY(32).MaxWidth(860).FillWidth().Children(func() {
				if raw := d.Ed.Buffer.String(); raw != d.raw || d.view == "" && raw != "" {
					d.raw, d.view = raw, rewrite(raw)
				}
				markdown.View(c, d.view, &d.md)
			})
		})
		return
	}
	editor.View(c, d.Ed).Key(fmt.Sprintf("ed-%d", p.Info.ID)).Grow(1).Fill()
}

func (v *Viewer) status(c *ui.Context, p tabtypes.Props) {
	d := v.doc(p)
	if d.source {
		d.Cursor(c)
	}
	d.Language(c)
}

func (v *Viewer) actions(c *ui.Context, p tabtypes.Props) {
	d := v.doc(p)
	label, icon := "Switch to source view", lucide.Code()
	if d.source {
		label, icon = "Switch to reading view", lucide.BookOpen()
	}
	omgui.Button(c, omgui.ButtonProps{Label: label, Icon: icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
		OnClick: func() { d.source = !d.source }}).Tooltip(label + " (Ctrl E)")
}

func (v *Viewer) menu(id int) []tabtypes.MenuItem {
	d, ok := v.docs[id]
	if !ok {
		return nil
	}
	return []tabtypes.MenuItem{{Title: "Toggle reading view", Icon: lucide.BookOpen(), Checked: !d.source, Run: func() { d.source = !d.source }}}
}

func (v *Viewer) followLink(from, url string) {
	if strings.HasPrefix(url, "#") {
		return
	}
	if name, ok := strings.CutPrefix(url, linkScheme); ok {
		if n, err := neturl.PathUnescape(name); err == nil {
			name = n
		}
		v.openLink(from, name)
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
	if v.ws != nil {
		v.ws.Open(filepath.Clean(p), nil, false)
	}
}
