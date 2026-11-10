package web

import (
	"regexp"
	"sort"
	"strings"

	"github.com/cunninghamcard-bit/acard-ui/components/popover"
	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
	auiicon "github.com/cunninghamcard-bit/attention/native/ui/icon"
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
		return icon.Search.SVG()
	case "history":
		return icon.Clock.SVG()
	case "bookmark":
		return auiicon.Must("bookmark")
	}
	return icon.Globe.SVG()
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
// the highlighted one, a click opens one. It hangs from bar, the column
// around field, which a press on the field does not click, so the press
// that gives the field the caret does not toggle the popover shut.
func (v *viewer) suggestPanel(c *ui.Context, pg *page, bar, field ui.Element, open func(url string)) {
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
	w := bar.Bounds().W
	popover.Popover(c, bar, &pg.suggesting, popover.PopoverProps{Label: "Suggestions",
		Panel: func(panel ui.Element) ui.Element { return panel.Width(w).MinWidth(w).MaxWidth(w).Padding(5) },
		Content: func() {
			ui.Column(c).FillWidth().Gap(1).Children(func() {
				for i, s := range list {
					label, detail := s.url, ""
					if s.title != "" {
						label, detail = s.title, s.url
					}
					aui.CommandRow(c, aui.CommandRowProps{Key: "suggest:" + s.kind + s.url, Label: label, Detail: detail,
						Icon: s.icon(), Selected: i == pg.selected, OnClick: func() { open(s.url) }})
				}
			})
		}})
}

// source is the suggestions as a palette source, for the omnibox: what
// the input opens, then the history and the pinned pages that match.
func (v *viewer) source() slots.PaletteSource {
	return slots.PaletteSource{ID: ID, Items: v.paletteItems}
}

func (v *viewer) paletteItems(query string) []slots.PaletteItem {
	var out []slots.PaletteItem
	for _, s := range v.suggestions(query) {
		label, detail := s.url, ""
		switch {
		case s.kind == "about":
			continue
		case s.kind == "search":
			label = "Search the web for “" + s.title + "”"
		case s.title != "":
			label, detail = s.title, s.url
		}
		out = append(out, slots.PaletteItem{Key: "web:" + s.kind + s.url, Label: label, Detail: detail, Icon: s.icon(),
			Choose: func(newTab bool) {
				_ = v.ws.OpenResource(s.url, workspace.OpenOptions{Kind: Kind, NewTab: newTab})
			}})
	}
	return out
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
