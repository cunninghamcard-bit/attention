package chat

import (
	"fmt"
	"math"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/cunninghamcard-bit/acard-ui/components/button"
	"github.com/cunninghamcard-bit/acard-ui/components/input"
	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"

	"github.com/cunninghamcard-bit/attention/native/internal/dim"
	"github.com/cunninghamcard-bit/attention/native/internal/fuzzy"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

const (
	columnWidth = 760
	maxQuote    = 40
)

// body is a Chat tab: the messages, the reply streaming in, and the field.
func (ch *Chat) body(c *ui.Context, p tabtypes.Props) {
	t := ch.thread(strings.TrimPrefix(p.Info.Address, AddressPrefix))
	th := c.Theme()
	if t == nil {
		ui.Column(c).Grow(1).Fill().Center().Children(func() {
			ui.Text(c, "This thread no longer exists.").TextColor(th.TextMuted)
		})
		return
	}
	l := ch.state(t)
	if t.SessionID != "" && !l.loaded && !l.loading {
		ch.load(l)
	}
	if title := ch.title(p.Info.Address); title != p.Info.Title && p.SetTitle != nil {
		p.SetTitle(title)
	}
	ui.Column(c).Grow(1).Fill().Background(th.Background).Children(func() {
		if l.scroll.Y >= l.scroll.MaxY {
			l.scroll.Y = math.MaxFloat32
		}
		ui.Scroll(c).Key(fmt.Sprintf("chat-%d", p.Info.ID)).TrackScroll(&l.scroll).Grow(1).FillWidth().Children(func() {
			ui.Column(c).FillWidth().AlignItems(ui.Center).Padding(24, 24, 16, 24).Children(func() {
				ui.Column(c).FillWidth().MaxWidth(columnWidth).Gap(18).Selectable().Children(func() {
					ch.messages(c, l)
				})
			})
		})
		ui.Column(c).FillWidth().AlignItems(ui.Center).Padding(0, 24, 18, 24).Children(func() {
			ui.Column(c).FillWidth().MaxWidth(columnWidth).Children(func() { ch.composer(c, l) })
		})
	})
}

func (ch *Chat) messages(c *ui.Context, l *live) {
	th := c.Theme()
	if len(l.messages) == 0 && l.sent == "" && !l.loading {
		ui.Column(c).FillWidth().Gap(6).Padding(64, 0, 0, 0).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icon.Sparkles.SVG()).Size(22, 22).TextColor(th.TextMuted)
			ui.Text(c, "Ask dim about "+filepath.Base(l.thread.Cwd)).FontSize(15).TextColor(th.Text)
			ui.Text(c, "Select text in a file and press "+shortcut()+" to quote it here.").FontSize(12).TextColor(th.TextMuted)
		})
	}
	if l.loading {
		ui.Text(c, "Loading the thread…").FontSize(12).TextColor(th.TextMuted)
	}
	ms := l.messages
	// A running turn's committed steps and its uncommitted output read as one reply.
	merge := l.running && l.sent == "" && len(ms) > 0 && ms[len(ms)-1].Role == dim.Assistant
	for i, m := range ms {
		switch {
		case m.Role == dim.User:
			userBubble(c, m.Text)
		case merge && i == len(ms)-1:
			m.Text, m.Thinking = m.Text+l.stream.Text, m.Thinking+l.stream.Thinking
			ch.reply(c, l, i, m, true)
		default:
			ch.reply(c, l, i, m, false)
		}
	}
	if l.sent != "" {
		userBubble(c, l.sent)
	}
	if !merge && (l.running || l.sent != "" || l.stream.Text != "" || l.stream.Thinking != "") {
		ch.reply(c, l, -1, l.stream, true)
	}
	if l.err != "" {
		ui.Row(c).FillWidth().Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icon.TriangleAlert.SVG()).Size(14, 14).TextColor(aui.TokensOf(c).Error).Shrink(0)
			ui.Text(c, l.err).FontSize(12).TextColor(aui.TokensOf(c).Error).Grow(1)
			if l.thread.SessionID != "" && !l.loading && button.Button(c, button.ButtonProps{Variant: button.ButtonGhost, Size: button.ButtonSm,
				LabelKey: "Retry", Children: func() { ui.Text(c, "Retry") }}).Clicked() {
				l.err, l.loaded = "", false
			}
		})
	}
}

// reply is the assistant's side of a turn: its thinking (folded), the
// tools it used and its text as Markdown, streaming while live.
func (ch *Chat) reply(c *ui.Context, l *live, i int, m dim.Message, live bool) {
	th := c.Theme()
	ui.Column(c).FillWidth().Gap(8).Children(func() {
		if m.Thinking != "" {
			open := l.open[i]
			label := "Thought"
			if live && m.Text == "" {
				label = "Thinking…"
			}
			ui.Row(c).Key(fmt.Sprintf("think-%d", i)).Gap(4).AlignItems(ui.Center).Cursor(ui.CursorPointer).Unselectable().Children(func() {
				glyph := icon.ChevronRight
				if open {
					glyph = icon.ChevronDown
				}
				ui.Icon(c, glyph.SVG()).Size(12, 12).TextColor(th.TextMuted)
				ui.Text(c, label).FontSize(12).TextColor(th.TextMuted)
			}).OnClick(func() { l.open[i] = !open })
			if open {
				ui.Text(c, m.Thinking).FontSize(12).TextColor(th.TextMuted).Wrap().FillWidth()
			}
		}
		if len(m.Tools) > 0 {
			ui.Text(c, "Used "+strings.Join(compact(m.Tools), ", ")).FontSize(12).TextColor(th.TextMuted)
		}
		opts := markdown.Options{Theme: ch.app.Markdown(th.Dark), WrapCode: true}
		switch {
		case live && m.Text == "" && m.Thinking == "":
			ui.Text(c, "…").TextColor(th.TextMuted)
		case live:
			markdown.Stream(c, m.Text, &opts)
		case m.Text != "":
			markdown.View(c, m.Text, &opts)
		}
		if m.Failed {
			ui.Text(c, "The turn failed.").FontSize(12).TextColor(aui.TokensOf(c).Error)
		}
	})
}

// composer is the quote being asked about, the field and Send or Stop.
func (ch *Chat) composer(c *ui.Context, l *live) {
	th := c.Theme()
	k := aui.TokensOf(c)
	ui.Column(c).FillWidth().Gap(8).Children(func() {
		if l.quote != "" {
			ui.Row(c).FillWidth().Gap(8).AlignItems(ui.Start).Padding(8, 10).Radius(10).Background(k.BgField).Children(func() {
				ui.Text(c, clip(l.quote, maxQuote)).FontSize(12).TextColor(th.TextMuted).Wrap().Grow(1)
				x := button.Button(c, button.ButtonProps{Label: "Remove the quote", Variant: button.ButtonGhost, Size: button.ButtonSm,
					Children: func() { ui.Icon(c, icon.X.SVG()).Size(12, 12) }}).Size(24, 24).MinHeight(24).PaddingX(0).Shrink(0)
				if x.Clicked() {
					l.quote = ""
				}
			})
		}
		ui.Row(c).FillWidth().Gap(8).AlignItems(ui.Center).Children(func() {
			var field ui.Element
			ui.Column(c).Grow(1).MinWidth(0).Children(func() {
				field = input.Input(c, &l.draft, input.InputProps{Placeholder: "Ask about " + filepath.Base(l.thread.Cwd) + "…"}).
					Label("Ask dim")
			})
			if l.focus {
				field.Focus()
				l.focus = false
			}
			if field.Submitted() {
				ch.send(l)
			}
			label, glyph, act := "Send", icon.Send, func() { ch.send(l) }
			if l.running && !l.busy {
				label, glyph, act = "Stop", icon.Square, func() { ch.stop(l) }
			}
			if labelled(c, button.ButtonSecondary, "", glyph, label).Clicked() {
				act()
			}
		})
	})
}

// threadItems are the threads matching query, last used first.
func (ch *Chat) threadItems(query string) []slots.PaletteItem {
	ts := slices.Clone(ch.threads)
	slices.SortStableFunc(ts, func(a, b *Thread) int { return b.Used.Compare(a.Used) })
	text := func(t *Thread) string { return ch.title(AddressPrefix+t.ID) + " " + filepath.Base(t.Cwd) }
	var picked []*Thread
	if strings.TrimSpace(query) == "" {
		picked = ts[:min(len(ts), 30)]
	} else {
		for _, r := range fuzzy.Rank(query, len(ts), func(i int) string { return text(ts[i]) }, 30) {
			picked = append(picked, ts[r.Index])
		}
	}
	out := make([]slots.PaletteItem, 0, len(picked))
	for _, t := range picked {
		out = append(out, slots.PaletteItem{Key: "thread:" + t.ID, Label: ch.title(AddressPrefix + t.ID),
			Detail: filepath.Base(t.Cwd) + " · " + ago(t.Used), Icon: icon.MessageCircle.SVG(), Hint: "Open thread",
			Choose: func(bool) { ch.openThread(t, false) }})
	}
	return out
}

func userBubble(c *ui.Context, text string) {
	k := aui.TokensOf(c)
	ui.Row(c).FillWidth().Justify(ui.End).Children(func() {
		ui.Text(c, text).Wrap().MaxWidth(columnWidth*0.8).Padding(10, 14).Radius(14).
			Background(k.BgField).TextColor(c.Theme().Text)
	})
}

func labelled(c *ui.Context, variant button.ButtonVariant, size button.ButtonSize, glyph icon.Icon, label string) ui.Element {
	return button.Button(c, button.ButtonProps{Variant: variant, Size: size, LabelKey: label, Children: func() {
		ui.Icon(c, glyph.SVG()).Size(14, 14)
		ui.Text(c, label)
	}})
}

// compact is names without repeats, in first-use order.
func compact(names []string) []string {
	var out []string
	for _, n := range names {
		if !slices.Contains(out, n) {
			out = append(out, n)
		}
	}
	return out
}

// clip is s cut to its first n lines.
func clip(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) <= n {
		return s
	}
	return strings.Join(lines[:n], "\n") + "\n…"
}

func ago(t time.Time) string {
	switch d := time.Since(t); {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return t.Format("Jan 2")
	}
}
