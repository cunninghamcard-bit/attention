package chat

import (
	"fmt"
	"runtime"
	"strings"

	"github.com/cunninghamcard-bit/acard-ui/components/button"
	"github.com/cunninghamcard-bit/acard-ui/components/tooltip"
	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

// selectionBar floats over the window while the active tab has a
// selection: Ask quotes it into a thread and puts the caret there, Add to
// thread only quotes it (RFC 0006 §7.4).
func (ch *Chat) selectionBar(c *ui.Context) {
	if _, ok := ch.activeSelection(); !ok {
		return
	}
	k := aui.TokensOf(c)
	bar := ui.Row(c).Key("chat:selection-bar").Absolute().Bottom(28).Right(28).Gap(4).Padding(4).Radius(12).
		Background(k.BgRaised).AlignItems(ui.Center)
	k.ShadowMedium.On(bar).Children(func() {
		ask := labelled(c, button.ButtonGhost, button.ButtonSm, icon.Sparkles, "Ask")
		tooltip.Tooltip(c, ask, tooltip.TooltipProps{Text: "Ask about the selection (" + shortcut() + ")"})
		if ask.Clicked() {
			ch.askSelection(true)
		}
		if labelled(c, button.ButtonGhost, button.ButtonSm, icon.Plus, "Add to thread").Clicked() {
			ch.askSelection(false)
		}
	})
}

// askSelection quotes the active tab's selection into the project's last
// used thread, or a new one, and shows the thread beside the text; focus
// puts the caret in its field.
func (ch *Chat) askSelection(focus bool) {
	sel, ok := ch.activeSelection()
	if !ok {
		return
	}
	info, _ := ch.ws.ActiveTab()
	t := ch.projectThread(ch.activeCwd())
	l := ch.state(t)
	q := quote(sel, ch.source(info))
	if l.quote != "" {
		q = l.quote + "\n\n" + q
	}
	l.quote = q
	ch.openThread(t, true)
	l.focus = focus
}

// activeSelection is the active tab's selection, from its tab type; none
// in a Chat tab.
func (ch *Chat) activeSelection() (tabtypes.Selection, bool) {
	info, ok := ch.ws.ActiveTab()
	if !ok || info.Kind == Kind {
		return tabtypes.Selection{}, false
	}
	tt, ok := ch.tt.Claim(info.Address, info.Kind)
	if !ok || tt.Selection == nil {
		return tabtypes.Selection{}, false
	}
	sel, ok := tt.Selection(info.ID)
	if !ok || strings.TrimSpace(sel.Text) == "" {
		return tabtypes.Selection{}, false
	}
	return sel, true
}

// source names where a tab's text comes from: its file as the workspace
// shows it, else its title and address.
func (ch *Chat) source(info tabtypes.Info) string {
	if info.Path != "" {
		return ch.ws.Display(info.Path)
	}
	return strings.TrimSpace(info.Title + " — " + info.Address)
}

// quote is sel quoted line by line with its source under it, as
// "— path:L12-30" (RFC 0006 §7.4).
func quote(sel tabtypes.Selection, source string) string {
	var b strings.Builder
	for line := range strings.SplitSeq(strings.TrimRight(sel.Text, "\n"), "\n") {
		b.WriteString("> " + line + "\n")
	}
	b.WriteString("— " + source)
	switch {
	case sel.From > 0 && sel.To > sel.From:
		fmt.Fprintf(&b, ":L%d-%d", sel.From, sel.To)
	case sel.From > 0:
		fmt.Fprintf(&b, ":L%d", sel.From)
	}
	return b.String()
}

// shortcut is Ask about selection's keys as the platform writes them.
func shortcut() string {
	if runtime.GOOS == "darwin" {
		return "⇧⌘L"
	}
	return "Ctrl+Shift+L"
}
