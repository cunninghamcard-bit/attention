// Package omnibox is the omnibox (RFC 0003 §3): one palette over the open
// tabs, the files, the web and the commands, made of their own palette
// sources. Ctrl L and the address bar open it on the active tab; Ctrl T
// and New tab open it on a new tab, so that closing it opens nothing.
package omnibox

import (
	"context"
	"strings"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
)

const (
	// ID is the plugin's name and the source opening on the active tab;
	// NewTabID the source opening on a new tab.
	ID       = "omnibox"
	NewTabID = "omnibox-new"

	placeholder = "Search tabs, files and commands, or enter a URL…"
)

var (
	// sections are the sources it shows, in order, and how many rows of
	// each; web goes first for an address.
	sections = []section{{"tabs", 3}, {"switcher", 8}, {"web", 5}, {"command-palette", 5}}

	// idle are those it shows with nothing typed: the recent files and
	// the history.
	idle = []section{{"switcher", 8}, {"web", 5}}

	// Plugin is the omnibox while loaded.
	Plugin = rutis.Define(rutis.Plugin[struct{}]{
		Name:   ID,
		Inject: []string{"shell", "slots", "actions"},
		Apply: func(rctx *rutis.Ctx, _ struct{}) error {
			var (
				sh  *shell.Shell
				sl  *slots.Registry
				act *actions.Service
			)
			if err := rctx.Use("shell", &sh); err != nil {
				return err
			}
			if err := rctx.Use("slots", &sl); err != nil {
				return err
			}
			if err := rctx.Use("actions", &act); err != nil {
				return err
			}
			off := Register(sl, sh, act)
			rctx.Effect(func(context.Context) error { off(); return nil })
			return nil
		},
	})
)

type section struct {
	source string
	rows   int
}

// Register adds the two sources and their commands until off is called.
func Register(sl *slots.Registry, sh *shell.Shell, act *actions.Service) (off func()) {
	cmd := func(id, title, keys, source string) actions.Command {
		open := func() { sl.OpenPalette(source) }
		return actions.Command{ID: id, Title: title, Keys: keys, Main: open,
			Run: func(ctx context.Context, _ actions.Args) (string, error) {
				return shell.OnMain(ctx, sh, func() (string, error) { open(); return "", nil })
			}}
	}
	offs := []func(){
		sl.RegisterPaletteSource(source(sl, ID, false)),
		sl.RegisterPaletteSource(source(sl, NewTabID, true)),
		act.Add(cmd("omnibox:open", "Open omnibox", "Ctrl L", ID)),
		act.Add(cmd("omnibox:new-tab", "New tab", "Ctrl T", NewTabID)),
	}
	return func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
	}
}

// source is the omnibox as palette source id; newTab opens every choice
// in a new tab.
func source(sl *slots.Registry, id string, newTab bool) slots.PaletteSource {
	each := func(fn func(src *slots.PaletteSource)) {
		for _, s := range sections {
			if src := sl.LookupPaletteSource(s.source); src != nil {
				fn(src)
			}
		}
	}
	return slots.PaletteSource{
		ID: id, Placeholder: placeholder,
		Open: func() {
			each(func(src *slots.PaletteSource) {
				if src.Open != nil {
					src.Open()
				}
			})
		},
		Generation: func() int {
			gen := 0
			each(func(src *slots.PaletteSource) {
				if src.Generation != nil {
					gen += src.Generation()
				}
			})
			return gen
		},
		Items: func(query string) []slots.PaletteItem { return items(sl, query, newTab) },
		Empty: func(string) string { return "No matches" },
	}
}

// items are each section's best rows, in order.
func items(sl *slots.Registry, query string, newTab bool) []slots.PaletteItem {
	order := sections
	switch q := strings.TrimSpace(query); {
	case q == "":
		order = idle
	case looksLikeAddress(q):
		order = append([]section{{"web", 5}}, without(sections, "web")...)
	}
	var out []slots.PaletteItem
	for _, s := range order {
		src := sl.LookupPaletteSource(s.source)
		if src == nil || src.Items == nil {
			continue
		}
		rows := src.Items(query)
		for _, it := range rows[:min(len(rows), s.rows)] {
			if newTab && it.Choose != nil {
				choose := it.Choose
				it.Choose = func(bool) { choose(true) }
			}
			out = append(out, it)
		}
	}
	return out
}

func without(ss []section, source string) []section {
	var out []section
	for _, s := range ss {
		if s.source != source {
			out = append(out, s)
		}
	}
	return out
}

// looksLikeAddress reports whether q names a page: a scheme, or a host
// with a dot and no space.
func looksLikeAddress(q string) bool {
	if strings.Contains(q, "://") {
		return true
	}
	host, _, _ := strings.Cut(q, "/")
	dot := strings.LastIndexByte(host, '.')
	return !strings.ContainsAny(q, " \t") && dot > 0 && dot < len(host)-1
}
