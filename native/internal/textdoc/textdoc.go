// Package textdoc is a tab's read-only text, shared by the text viewer and
// the markdown viewer's source view: it reads the file through fs when the
// tab's Version moves, keeps the reader's place across a refresh, and
// applies the tab's navigation once there is text.
package textdoc

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
)

// MaxBytes is the most a text tab reads.
const MaxBytes = 8 << 20

// Loader reads documents; post runs a function on the main thread
// (shellapi.Update; tests hand their own).
type Loader struct {
	Ctx  context.Context
	FS   fscontract.FS
	Post func(func())
}

// Sync reads the file when the tab's Version moved and applies a new
// navigation; the body calls it every frame.
func (l *Loader) Sync(d *Doc, p tabtypesapi.Props) {
	d.Path = p.Info.Path
	if p.Info.NavRevision != d.navWant {
		d.navWant, d.nav = p.Info.NavRevision, p.Info.Nav
		d.applyNav()
	}
	// A change during a read is read once that read is back: the frame it
	// redraws syncs again.
	if !d.loading && !p.Info.Pending && (!d.loaded || p.Info.Version != d.version) {
		d.version = p.Info.Version
		l.load(d)
	}
}

func (l *Loader) load(d *Doc) {
	d.loading = true
	d.loaded = true
	path := d.Path
	start := time.Now()
	go func() {
		file, err := l.FS.Read(l.Ctx, path, MaxBytes)
		l.Post(func() {
			debugf("tab: loaded %s in %s", path, time.Since(start))
			d.loading = false
			if err != nil {
				if errors.Is(err, os.ErrNotExist) {
					d.Gone = true
				} else {
					d.Err = err.Error()
				}
			} else {
				d.Err, d.Gone = "", false
				d.File = file
				d.setText(file)
				d.applyNav()
			}
		})
	}()
}

// Doc is one tab's text, on the main thread only.
type Doc struct {
	Path string
	File fscontract.File
	Ed   *editor.State // nil until loaded, and for binary and too large files
	Err  string
	// Gone is set while the last read found no file.
	Gone bool

	loaded  bool
	loading bool
	version int // the Version last read (or being read)
	navRev  int // the NavRevision last applied
	nav     *tabtypesapi.Nav
	navWant int
	// OnNav, optional, runs when a navigation is applied.
	OnNav func()
}

// Placeholder draws what stands in for the text, and reports whether it
// drew one: the error, a binary or too large file, a file never read and
// gone, or loading.
func (d *Doc) Placeholder(c *ui.Context) bool {
	switch {
	case d.Err != "":
		Centered(c, d.Err)
	case d.File.Binary:
		Centered(c, "This is a binary file and is not shown.")
	case d.File.TooLarge:
		Centered(c, fmt.Sprintf("This file is %s, larger than the %s shown.", Size(d.File.Size), Size(MaxBytes)))
	case d.Ed == nil && d.Gone:
		Centered(c, "This file does not exist.")
	case d.Ed == nil:
		Centered(c, "Loading…")
	default:
		return false
	}
	return true
}

// Lines is the caret's line (1-based) and the line count, false before
// there is text.
func (d *Doc) Lines() (cur, lines int, ok bool) {
	if d == nil || d.Ed == nil {
		return 0, 0, false
	}
	return d.Ed.CursorPos().Line + 1, d.Ed.Buffer.LineCount(), true
}

// Cursor draws the caret's line and column in the status bar.
func (d *Doc) Cursor(c *ui.Context) {
	if d.Ed != nil {
		pos := d.Ed.CursorPos()
		ui.Text(c, fmt.Sprintf("%d:%d", pos.Line+1, pos.Col+1)).FontSize(12).TextColor(c.Theme().TextMuted)
	}
}

// Language draws the text's language in the status bar.
func (d *Doc) Language(c *ui.Context) {
	lang := "Plain Text"
	if d.Ed != nil {
		if l := d.Ed.Buffer.Language(); l != nil {
			lang = l.Name
		}
	}
	ui.Text(c, lang).FontSize(12).TextColor(c.Theme().TextMuted)
}

// setText puts the file's text in the tab, keeping the first visible line
// when the text is replaced on a refresh.
func (d *Doc) setText(f fscontract.File) {
	if f.Binary || f.TooLarge {
		d.Ed = nil
		return
	}
	if d.Ed == nil {
		buf := editor.NewBuffer(f.Text)
		buf.SetLanguage(editor.LanguageFor(d.Path))
		d.Ed = &editor.State{Buffer: buf, ReadOnly: true}
		return
	}
	// Keep where the reader was: the first visible line and the carets,
	// by line and column, clamped to the new text.
	first, _ := d.Ed.VisibleLines()
	type caret struct{ anchor, head editor.Pos }
	var carets []caret
	for _, s := range d.Ed.Selections() {
		carets = append(carets, caret{d.Ed.Buffer.Pos(s.Anchor), d.Ed.Buffer.Pos(s.Head)})
	}
	d.Ed.Buffer.Reset(f.Text)
	clamp := func(p editor.Pos) int {
		lines := d.Ed.Buffer.LineCount()
		p.Line = max(0, min(p.Line, lines-1))
		p.Col = max(0, min(p.Col, len(d.Ed.Buffer.Line(p.Line))))
		return d.Ed.Buffer.Offset(p)
	}
	if len(carets) > 0 {
		sels := make([]editor.Selection, len(carets))
		for i, c := range carets {
			sels[i] = editor.Selection{Anchor: clamp(c.anchor), Head: clamp(c.head)}
		}
		d.Ed.SetSelections(sels...)
	}
	if first > 0 {
		d.Ed.ScrollTo(min(first, max(0, d.Ed.Buffer.LineCount()-1)))
	}
}

// applyNav moves the editor to the pending navigation once there is text:
// a match (Col, Len) is selected, else lines Line through To.
func (d *Doc) applyNav() {
	if d.nav == nil || d.Ed == nil || d.navRev == d.navWant {
		return
	}
	n := *d.nav
	d.navRev = d.navWant
	if d.OnNav != nil {
		d.OnNav()
	}
	buf := d.Ed.Buffer
	lines := buf.LineCount()
	from := max(1, min(n.Line, lines)) - 1
	if n.Col > 0 {
		text := buf.Line(from)
		col := min(n.Col-1, len(text))
		end := min(col+n.Len, len(text))
		d.Ed.GoTo(editor.Pos{Line: from, Col: col})
		d.Ed.Select(buf.Offset(editor.Pos{Line: from, Col: col}), buf.Offset(editor.Pos{Line: from, Col: end}))
		return
	}
	to := from
	if n.To > 0 {
		to = max(from, min(n.To, lines)-1)
	}
	start := buf.Offset(editor.Pos{Line: from})
	end := buf.Offset(editor.Pos{Line: to, Col: len(buf.Line(to))})
	d.Ed.GoTo(editor.Pos{Line: from})
	d.Ed.Select(start, end)
}

// Centered draws a muted message in the middle of the tab.
func Centered(c *ui.Context, text string) {
	ui.Column(c).Grow(1).Fill().Center().Children(func() {
		ui.Text(c, text).TextColor(c.Theme().TextMuted)
	})
}

// Size is a byte count for people.
func Size(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	}
	return strconv.FormatInt(n, 10) + " B"
}

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
