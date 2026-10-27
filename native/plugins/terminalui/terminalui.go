// Package terminalui is the terminal (RFC 0001 roadmap P4), attention's
// terminal plugin (apps/web/builtin/terminal: TerminalPlugin.ts,
// TerminalService.ts, TerminalView.ts) over mygo's terminal, libghostty-vt
// in a pseudo-terminal: a tab per shell, the user's login shell in the
// active file's folder, Open terminal (Ctrl J), and the Terminal settings tab.
//
// While a terminal has the focus, the window's shortcuts leave it its keys
// (actionsapi.SetCapture), as the TS view's focus scope does.
//
// Left out: Default location (always a new tab), the remote terminal
// server, Open terminal here in the file menu.
package terminalui

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/plugins/terminal"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	"github.com/cunninghamcard-bit/attention/native/settingsapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// ID is the plugin's and its type's; Kind the tab kind
// (TERMINAL_VIEW_TYPE).
const (
	ID   = "terminal-ui"
	Kind = "terminal"
)

// configFile is the Terminal settings' file.
const configFile = "terminal"

// session is a tab's shell: its terminal, or why there is none.
type session struct {
	term   *terminal.Terminal
	err    string
	exited bool
	code   int
	dir    string
}

// Terminals are the tabs' sessions, on the main thread only.
type Terminals struct {
	sessions map[int]*session
	next     int
	pending  string // the folder the next terminal starts in
}

// address is a new terminal's: one each, so each opens a tab of its own.
func (t *Terminals) address() string {
	t.next++
	return "attention://terminal/" + strconv.Itoa(t.next)
}

// open is terminal:open: a terminal in a new tab, in dir or the first
// folder (TerminalService.open).
func (t *Terminals) open(dir string) {
	ws := workspaceapi.Get()
	if ws == nil {
		return
	}
	if dir == "" {
		dir = defaultDir()
	}
	t.pending = dir
	_ = ws.OpenResource(t.address(), workspaceapi.OpenOptions{Kind: Kind, NewTab: true})
}

// defaultDir is the active file's folder, else the home folder (the TS
// defaultCwd is the vault's; the reader has no one folder).
func defaultDir() string {
	if ws := workspaceapi.Get(); ws != nil {
		if info, ok := ws.ActiveTab(); ok && info.Path != "" {
			return filepath.Dir(info.Path)
		}
	}
	home, _ := os.UserHomeDir()
	return home
}

// font is the Terminal settings' font.
func font() terminal.Font {
	var f terminal.Font
	settingsapi.Get(configFile, "fontFamily", &f.Family)
	settingsapi.Get(configFile, "fontSize", &f.Size)
	return f
}

// start runs a shell for s (TerminalService.spawnInto).
func (t *Terminals) start(s *session) {
	term, err := terminal.New(terminal.Options{
		Dir:  s.dir,
		Font: font(),
		OnExit: func(code int) {
			shellapi.Update(func() { s.exited, s.code = true, code })
		},
	})
	if err != nil {
		debugf("terminal: %v", err)
		s.err = err.Error()
		return
	}
	debugf("terminal: started in %s", s.dir)
	s.term, s.err, s.exited = term, "", false
}

// get is tab id's session, its shell started on first sight.
func (t *Terminals) get(id int) *session {
	s, ok := t.sessions[id]
	if !ok {
		dir := t.pending
		t.pending = ""
		if dir == "" {
			dir = defaultDir()
		}
		s = &session{dir: dir}
		t.sessions[id] = s
		t.start(s)
	}
	return s
}

// body is TerminalView: the terminal, or why there is none; once its
// shell exited, a Restart.
func (t *Terminals) body(c *ui.Context, p tabtypesapi.Props) {
	s := t.get(p.Info.ID)
	th := c.Theme()
	ui.Column(c).Grow(1).Fill().Children(func() {
		if s.err != "" {
			ui.Column(c).Grow(1).Fill().Center().Gap(8).Children(func() {
				ui.Text(c, "Terminal unavailable").FontWeight(600)
				ui.Text(c, s.err).FontSize(12).TextColor(th.TextMuted)
				omgui.Button(c, omgui.ButtonProps{Label: "Retry", Variant: omgui.ButtonSecondary, OnClick: func() { t.start(s) }})
			})
			return
		}
		if s.exited {
			ui.Row(c).Padding(6, 12).Gap(8).AlignItems(ui.Center).Background(th.Surface).BorderWidth(0, 0, 1, 0).BorderColor(th.Border).Children(func() {
				ui.Text(c, fmt.Sprintf("Shell exited with code %d.", s.code)).FontSize(12).Grow(1)
				omgui.Button(c, omgui.ButtonProps{Label: "Restart", Variant: omgui.ButtonSecondary, OnClick: func() {
					if s.term != nil {
						_ = s.term.Close()
					}
					t.start(s)
				}})
			})
		}
		if s.term == nil {
			textdoc.Centered(c, "Starting…")
			return
		}
		view := terminal.View(c, s.term).Key(fmt.Sprintf("term-%d", p.Info.ID)).Grow(1).Fill()
		if p.Info.Focused && !s.exited {
			view.AutoFocus()
		}
		if view.Focused() {
			actionsapi.SetCapture(true)
		}
	})
}

func (t *Terminals) closed(id int) {
	if s := t.sessions[id]; s != nil {
		delete(t.sessions, id)
		if s.term != nil {
			_ = s.term.Close()
		}
	}
}

// title is getDisplayText: Terminal — the shell's name.
func title(string) string {
	shell := filepath.Base(os.Getenv("SHELL"))
	if shell == "." || shell == "" {
		return "Terminal"
	}
	return "Terminal — " + shell
}

// settingTab is TerminalSettingTab: the font. There is no shell setting:
// the login shell from $SHELL runs, with the user's own dotfiles.
func settingTab(c *ui.Context) {
	omgui.SettingsSection(c, "Terminal", func() {
		omgui.PreferenceRow(c, "Font family", "A font family, or a comma-separated list; empty for the system's monospaced font.", func() {
			var cur string
			settingsapi.Get(configFile, "fontFamily", &cur)
			v := cur
			omgui.Field(c, &v, "monospace", false).Width(220)
			if v != cur {
				settingsapi.Set(configFile, "fontFamily", v)
			}
		})
		omgui.PreferenceRow(c, "Font size", "In points; empty for 13.", func() {
			var size float32
			settingsapi.Get(configFile, "fontSize", &size)
			cur := ""
			if size > 0 {
				cur = strconv.FormatFloat(float64(size), 'f', -1, 32)
			}
			v := cur
			omgui.Field(c, &v, "13", false).Width(80)
			if v != cur {
				if n, err := strconv.ParseFloat(v, 32); err == nil && n > 0 {
					settingsapi.Set(configFile, "fontSize", float32(n))
				} else if v == "" {
					settingsapi.Unset(configFile, "fontSize")
				}
			}
		})
	})
}

// Register adds the terminal tab type, its command and settings tab until
// off is called.
func Register() (off func()) {
	t := &Terminals{sessions: map[int]*session{}}
	openHere := func() { t.open("") }
	offs := []func(){
		tabtypesapi.Register(tabtypesapi.TabType{ID: ID, Kind: Kind, Priority: tabtypesapi.Builtin,
			Patterns: []string{"attention://terminal/*"}, Title: title, Icon: lucide.SquareTerminal(),
			Body: t.body, Closed: t.closed}),
		actionsapi.Register(actionsapi.Command{ID: "terminal:open", Title: "Open terminal", Keys: "Ctrl J", Main: openHere, CLI: true,
			Run: func(ctx context.Context, a actionsapi.Args) (string, error) {
				dir := a.Params["path"]
				if dir != "" && !filepath.IsAbs(dir) {
					dir = filepath.Join(a.Cwd, dir)
				}
				return shellapi.OnMain(ctx, func() (string, error) { t.open(dir); return "Opened terminal", nil })
			}}),
		slotsapi.RegisterSettingsSection(slotsapi.SettingsSection{ID: "terminal", Title: "Terminal", Icon: lucide.SquareTerminal(),
			Group: slotsapi.CorePlugins, Keywords: []string{"Font family", "Font size"}, View: settingTab}),
	}
	return func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
		shellapi.Update(func() {
			for id := range t.sessions {
				t.closed(id)
			}
		})
	}
}

// Plugin is the terminal while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "workspace"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		settingsapi.Load(configFile)
		off := Register()
		rctx.Effect(func(context.Context) error { off(); return nil })
		return nil
	},
})

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
