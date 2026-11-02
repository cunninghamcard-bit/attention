package web

import (
	"regexp"
	"sort"
	"strings"

	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

var typedURL = regexp.MustCompile(`(?i)^https?://`)

// The address bar's suggestions, attention's WebViewerAddressSuggest
// (apps/web/builtin/webviewer/WebViewerAddressSuggest.ts) and its
// AddressBarSuggest popover.

// suggestion is a WebViewerAddressSuggestion.
type suggestion struct {
	kind       string // about, typed, history, bookmark, search
	title, url string
	score      int
}

// icon is the suggestion's (AddressBarSuggest.renderSuggestion).
func (s suggestion) icon() *ui.SVG {
	switch s.kind {
	case "search":
		return icon.Must("search")
	case "history":
		return icon.Must("clock")
	case "bookmark":
		return icon.Must("bookmark")
	}
	return icon.Must("globe")
}

// suggestions are getSuggestions: the blank page, the history, the url
// bookmarks, by URL once, those the input matches best first, and what
// the input itself opens on top unless a candidate is it exactly.
func (v *viewer) suggestions(input string) []suggestion {
	raw := strings.TrimSpace(input)
	query := strings.ToLower(raw)
	var cands []suggestion
	seen := map[string]int{}
	add := func(s suggestion, replace bool) {
		if i, ok := seen[s.url]; ok {
			if replace {
				cands[i] = s
			}
			return
		}
		seen[s.url] = len(cands)
		cands = append(cands, s)
	}
	add(suggestion{kind: "about", title: "Blank", url: "about:blank"}, false)
	if v.hist != nil {
		if h := v.hist(); h != nil {
			for _, e := range h.List() {
				add(suggestion{kind: "history", title: e.Title, url: e.URL}, false)
			}
		}
	}
	if v.bm != nil {
		if b := v.bm(); b != nil {
			for _, u := range b.URLs() {
				add(suggestion{kind: "bookmark", title: u.Title, url: u.URL}, true)
			}
		}
	}
	var out []suggestion
	exact := false
	for _, c := range cands {
		if query == "" {
			out = append(out, c)
			continue
		}
		if strings.ToLower(c.url) == query {
			exact = true
		}
		if c.score = fuzzyScore(query, c.title+" "+c.url); c.score > 0 {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].score > out[j].score })
	if query != "" && !exact {
		first := raw
		if i := strings.IndexAny(raw, "/?#"); i >= 0 {
			first = raw[:i]
		}
		dot := strings.LastIndexByte(first, '.')
		switch {
		case typedURL.MatchString(raw):
			out = append([]suggestion{{kind: "typed", url: raw, score: 100}}, out...)
		case dot != -1 && dot != len(first)-1:
			out = append([]suggestion{{kind: "typed", url: "https://" + raw, score: 100}}, out...)
		default:
			out = append([]suggestion{{kind: "search", title: raw, url: v.normalizeURL(raw), score: 100}}, out...)
		}
	}
	return out[:min(len(out), 20)]
}

// suggestPanel is the popover under the address bar while it has the
// caret: Up and Down move the highlight, Enter (the bar's submit) opens
// the highlighted one, a click opens one.
func (v *viewer) suggestPanel(c *ui.Context, pg *page, field ui.Element, open func(url string)) {
	t := c.Theme()
	if !pg.suggesting {
		return
	}
	list := v.suggestions(pg.typed)
	pg.suggested = list
	if pg.selected >= len(list) {
		pg.selected = len(list) - 1
	}
	// The arrows move the highlight before the bar moves its caret.
	n := len(list)
	field.OnTextKey(func(k ui.TextKey) bool {
		if k.Mods != 0 || !pg.suggesting {
			return false
		}
		switch k.Key {
		case ui.KeyDown:
			pg.selected = min(pg.selected+1, n-1)
		case ui.KeyUp:
			pg.selected = max(pg.selected-1, 0)
		default:
			return false
		}
		return true
	})
	ui.PopoverBase(c, field, &pg.suggesting, func(panel ui.Element) {
		panel.Width(field.Bounds().W).Background(t.Surface).BorderWidth(1).BorderColor(t.Border).Radius(8).Padding(4).Shadow(0, 4, 16, 0, ui.RGBA(0, 0, 0, 0.16))
		ui.Column(c).FillWidth().Gap(1).Children(func() {
			for i, s := range list {
				row := ui.Row(c).Key("suggest:" + s.kind + s.url).FillWidth().Height(32).PaddingX(8).Gap(8).Radius(6).AlignItems(ui.Center).Cursor(ui.CursorPointer)
				if i == pg.selected || row.Hovered() {
					row.Background(t.SurfaceHover)
				}
				if row.Clicked() {
					open(s.url)
				}
				row.Children(func() {
					ui.Icon(c, s.icon()).Size(14, 14).TextColor(t.TextMuted).Shrink(0)
					if s.title != "" {
						ui.Text(c, s.title).FontSize(13).SingleLine().Ellipsis("…").Shrink(1)
					}
					ui.Text(c, s.url).FontSize(12).TextColor(t.TextMuted).SingleLine().Ellipsis("…").Shrink(2)
				})
			}
		})
	})
}

// fuzzyScore is the TS fuzzyScore: the query within the text, else its
// letters in order, closer ones scoring more; 0 for no match.
func fuzzyScore(query, text string) int {
	hay, needle := strings.ToLower(text), strings.ToLower(query)
	if strings.Contains(hay, needle) {
		return 80 + min(len(needle), 20)
	}
	index, score := 0, 0
	for _, r := range needle {
		found := strings.IndexRune(hay[index:], r)
		if found < 0 {
			return 0
		}
		score += max(1, 12-found)
		index += found + len(string(r))
	}
	return score
}
