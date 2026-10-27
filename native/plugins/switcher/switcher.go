// Package switcher is the quick switcher (attention's QuickSwitcher core
// plugin, apps/web/builtin/QuickSwitcher.ts): a palette source over every
// file of the mounts, the recent files with no query, and its command and
// ribbon icon.
package switcher

import (
	"context"
	"path/filepath"
	"sort"
	"strings"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/internal/fileicon"
	"github.com/cunninghamcard-bit/attention/native/internal/fuzzy"
	"github.com/cunninghamcard-bit/attention/native/internal/natural"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

const (
	// ID is the plugin's name and its palette source's.
	ID = "switcher"

	// maxResults is SuggestModal's limit (apps/web/ui/suggest/SuggestModal.ts).
	maxResults = 100
)

// Plugin is the quick switcher while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "project", "actions", "workspace"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var project projectcontract.Project
		if err := rctx.Use("project", &project); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		off := Register(New(ctx, project.Files, shellapi.Update))
		rctx.Effect(func(context.Context) error {
			off()
			cancel()
			return nil
		})
		return nil
	},
})

type filesFn func(context.Context) (projectcontract.Listing, error)

// Switcher is the source's state, on the main thread only.
type Switcher struct {
	ctx   context.Context
	files filesFn
	post  func(func())

	listing *projectcontract.Listing // the last walk
	busy    bool
	gen     int
	names   []string // titles: display paths, .md dropped
	paths   []string
}

// New is a switcher listing files with files and posting to the main
// thread with post.
func New(ctx context.Context, files filesFn, post func(func())) *Switcher {
	return &Switcher{ctx: ctx, files: files, post: post}
}

// SetListing uses a walk of the mounts (a test's, or one done elsewhere).
func (s *Switcher) SetListing(l projectcontract.Listing) {
	s.listing = &l
	s.useListing()
}

// Source is the switcher's palette source.
func (s *Switcher) Source() slotsapi.PaletteSource {
	return slotsapi.PaletteSource{
		ID: ID, Placeholder: "Search files…",
		Open:       s.refresh,
		Items:      s.items,
		Generation: func() int { return s.gen },
		Empty: func(query string) string {
			switch {
			case s.listing == nil:
				return "Listing files…"
			case strings.TrimSpace(query) == "":
				return "No recent files"
			}
			return "No matches"
		},
		Footer: func(c *ui.Context, _ string) {
			if s.listing != nil && s.listing.Truncated {
				ui.Text(c, "Listing stopped at its limit; narrow the mounts for a complete list.").
					TextColor(c.Theme().TextMuted).FontSize(11).Padding(4, 8)
			}
		},
	}
}

// refresh walks the mounts again on a goroutine; the last walk shows
// meanwhile.
func (s *Switcher) refresh() {
	if s.busy {
		return
	}
	s.busy = true
	go func() {
		listing, err := s.files(s.ctx)
		s.post(func() {
			s.busy = false
			if err == nil {
				s.SetListing(listing)
			}
		})
	}()
}

// useListing is QuickSwitcher.getItems: every file, sorted by path
// naturally, its text the path without ".md" (getQuickSwitcherFileTitle).
// The reader shows every file type (attention's showAllFileTypes).
func (s *Switcher) useListing() {
	ws := workspaceapi.Get()
	type item struct{ title, path string }
	items := make([]item, 0, len(s.listing.Files))
	for _, f := range s.listing.Files {
		display := f.Path
		if ws != nil {
			display = ws.Display(f.Path)
		}
		items = append(items, item{title(display), f.Path})
	}
	sort.SliceStable(items, func(i, j int) bool { return natural.Less(items[i].title, items[j].title) })
	s.names, s.paths = s.names[:0], s.paths[:0]
	for _, it := range items {
		s.names = append(s.names, it.title)
		s.paths = append(s.paths, it.path)
	}
	s.gen++
}

func (s *Switcher) item(i int) slotsapi.PaletteItem {
	name, path := s.names[i], s.paths[i]
	base, dir := name, ""
	if k := strings.LastIndexByte(name, '/'); k >= 0 {
		base, dir = name[k+1:], name[:k]
	}
	return slotsapi.PaletteItem{Key: "f:" + path, Label: base, Detail: dir, Icon: fileicon.For(base),
		Choose: func(newTab bool) {
			if ws := workspaceapi.Get(); ws != nil {
				ws.Open(path, nil, newTab)
			}
		}}
}

// items are QuickSwitcherModal.getSuggestions: the recent files with no
// query, else the files ranked against it.
func (s *Switcher) items(query string) []slotsapi.PaletteItem {
	q := strings.TrimSpace(query)
	var out []slotsapi.PaletteItem
	if q == "" {
		ws := workspaceapi.Get()
		if ws == nil {
			return nil
		}
		for _, path := range ws.RecentFiles() {
			for i, candidate := range s.paths {
				if candidate == path {
					out = append(out, s.item(i))
					break
				}
			}
		}
		return out
	}
	for _, r := range fuzzy.Rank(q, len(s.names), func(i int) string { return s.names[i] }, maxResults) {
		out = append(out, s.item(r.Index))
	}
	return out
}

// Register adds the source, its command and its ribbon icon until off is
// called.
func Register(s *Switcher) (off func()) {
	offs := []func(){
		slotsapi.RegisterPaletteSource(s.Source()),
		actionsapi.Register(actionsapi.Command{ID: "switcher:open", Title: "Open quick switcher", Keys: "Ctrl O", Main: open,
			Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
				return shellapi.OnMain(ctx, func() (string, error) { open(); return "", nil })
			}}),
		slotsapi.RegisterRibbon(slotsapi.RibbonItem{ID: ID, Title: "Open quick switcher", Icon: lucide.FileSearch(), Order: 0, Run: open}),
	}
	return func() {
		for _, off := range offs {
			off()
		}
	}
}

// title is getQuickSwitcherFileTitle: a Markdown file without its
// extension.
func title(display string) string {
	if strings.EqualFold(filepath.Ext(display), ".md") {
		return display[:len(display)-3]
	}
	return display
}

// open is switcher:open: the palette on the switcher.
func open() { slotsapi.OpenPalette(ID) }
