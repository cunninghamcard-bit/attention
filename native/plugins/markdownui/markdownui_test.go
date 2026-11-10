package markdownui

import (
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"

	"github.com/cunninghamcard-bit/attention/native/plugins/appearance"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
)

func TestReadingSelectionReadsAfterTheFrame(t *testing.T) {
	app := appearance.New(settings.New(nil, slots.New(nil)), t.TempDir(), func(f func()) { f() })
	raw := "# Title\n\nFirst paragraph sits here.\n\nSecond paragraph follows on.\n\nThird one ends it.\n"
	d := &doc{raw: raw, view: rewrite(raw)}
	v := &Viewer{docs: map[int]*doc{1: d}, app: app}
	tt := ui.NewTester(func(c *ui.Context) {
		d.md.Theme = app.Markdown(false)
		ui.Column(c).Fill().Padding(20).Children(func() {
			d.readingPicks = picks(markdown.View(c, d.view, &d.md))
		})
	}, 700, 500)
	tt.Frame()
	from, ok1 := tt.Find("Second paragraph follows on.")
	to, ok2 := tt.Find("Third one ends it.")
	if !ok1 || !ok2 {
		t.Fatalf("paragraphs not drawn: %v", tt.Texts())
	}
	tt.Press(from.X+2, from.Y+from.H/2)
	tt.Move(to.X+to.W-2, to.Y+to.H/2)
	tt.Release(to.X+to.W-2, to.Y+to.H/2)
	tt.Frame()
	sel, ok := v.selection(1)
	if !ok || sel.From != 5 || sel.To != 7 {
		t.Fatalf("selection = %+v, %v; want lines 5-7", sel, ok)
	}
}
