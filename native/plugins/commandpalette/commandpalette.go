// Package commandpalette is the command palette (attention's
// CommandPalette core plugin, apps/web/builtin/CommandPalette.ts): a
// palette source over every titled command, the recently run ones first,
// and its command and ribbon icon.
package commandpalette

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"github.com/arcships/rutis/go/rutis"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/fuzzy"
	"github.com/cunninghamcard-bit/attention/native/internal/natural"
	"github.com/cunninghamcard-bit/attention/native/plugins/shortcuts"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
)

// ID is the plugin's name and its palette source's.
const ID = "command-palette"

// maxResults is SuggestModal's limit; maxRecent CommandPalette's
// recentCommands cap.
const (
	maxResults = 100
	maxRecent  = 100
)

// Palette is the source's state, on the main thread only.
type Palette struct {
	ctx      context.Context
	recent   []string // command IDs, most recent first
	commands []actionsapi.Command
}

// New is a command palette running commands under ctx.
func New(ctx context.Context) *Palette { return &Palette{ctx: ctx} }

// Recent are the recently run commands' IDs, most recent first.
func (p *Palette) Recent() []string { return p.recent }

// load is CommandPalette.getCommands: by name naturally, the recently run
// ones first, most recent first.
func (p *Palette) load() {
	p.commands = p.commands[:0]
	for _, c := range actionsapi.List() {
		if c.Title != "" {
			p.commands = append(p.commands, c)
		}
	}
	sort.SliceStable(p.commands, func(i, j int) bool { return natural.Less(p.commands[i].Title, p.commands[j].Title) })
	order := map[string]int{}
	for i, id := range p.recent {
		order[id] = i + 1
	}
	rank := func(c actionsapi.Command) int {
		if n, ok := order[c.ID]; ok {
			return n
		}
		return len(order) + 1
	}
	sort.SliceStable(p.commands, func(i, j int) bool { return rank(p.commands[i]) < rank(p.commands[j]) })
}

// note is CommandPalette.recordRecent.
func (p *Palette) note(id string) {
	out := []string{id}
	for _, r := range p.recent {
		if r != id {
			out = append(out, r)
		}
	}
	if len(out) > maxRecent {
		out = out[:maxRecent]
	}
	p.recent = out
}

func (p *Palette) items(query string) []slotsapi.PaletteItem {
	q := strings.TrimSpace(query)
	idx := make([]int, 0, len(p.commands))
	if q == "" {
		for i := range p.commands {
			idx = append(idx, i)
		}
	} else {
		for _, r := range fuzzy.Rank(q, len(p.commands), func(i int) string { return p.commands[i].Title }, maxResults) {
			idx = append(idx, r.Index)
		}
	}
	out := make([]slotsapi.PaletteItem, 0, len(idx))
	for _, i := range idx {
		cmd := p.commands[i]
		out = append(out, slotsapi.PaletteItem{Key: "c:" + cmd.ID, Label: cmd.Title, Hint: shortcuts.EffectiveLabel(cmd),
			Choose: func(bool) {
				p.note(cmd.ID)
				if cmd.Main != nil {
					cmd.Main()
					return
				}
				go func() { _, _ = cmd.Run(p.ctx, actionsapi.Args{Params: map[string]string{}}) }()
			}})
	}
	return out
}

// Source is the command palette's source; its state is the recent
// commands.
func (p *Palette) Source() slotsapi.PaletteSource {
	return slotsapi.PaletteSource{
		ID: ID, Placeholder: "Execute a command…",
		Open:  p.load,
		Items: p.items,
		Empty: func(string) string { return "No matches" },
		State: func() json.RawMessage {
			b, _ := json.Marshal(p.recent)
			return b
		},
		Restore: func(st json.RawMessage) { _ = json.Unmarshal(st, &p.recent) },
	}
}

// open is command-palette:open.
func open() { slotsapi.OpenPalette(ID) }

// Register adds the source, its command and its ribbon icon until off is
// called.
func Register(p *Palette) (off func()) {
	offs := []func(){
		slotsapi.RegisterPaletteSource(p.Source()),
		actionsapi.Register(actionsapi.Command{ID: "command-palette:open", Title: "Open command palette", Keys: "Ctrl P", Main: open,
			Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
				return shellapi.OnMain(ctx, func() (string, error) { open(); return "", nil })
			}}),
		slotsapi.RegisterRibbon(slotsapi.RibbonItem{ID: ID, Title: "Open command palette", Icon: lucide.SquareTerminal(), Order: 1, Run: open}),
	}
	return func() {
		for _, off := range offs {
			off()
		}
	}
}

// Plugin is the command palette while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		ctx, cancel := context.WithCancel(context.Background())
		off := Register(New(ctx))
		rctx.Effect(func(context.Context) error {
			off()
			cancel()
			return nil
		})
		return nil
	},
})
