// Package terminalui is the terminal (RFC 0001 roadmap P4), attention's
// terminal plugin (apps/web/builtin/terminal: TerminalPlugin.ts,
// TerminalService.ts, TerminalView.ts) over mygo's terminal, libghostty-vt
// in a pseudo-terminal: a tab per shell, the user's login shell in the
// active file's folder, Open terminal (Ctrl J), and the Terminal settings tab.
//
// While a terminal has the focus, Control and a letter are its, as in
// gorex: the window's commands bound to them take Shift too there, and
// Control Shift C and V copy and paste (shortcuts.Shortcuts.SetCapture). Its title
// is the one the program sets (OSC 0 and 2), as terminals show it.
//
// Left out: Default location (always a new tab), the remote terminal
// server, Open terminal here in the file menu.
package terminalui

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/arcships/rutis/go/rutis"
	"github.com/cunninghamcard-bit/acard-ui/components/button"
	"github.com/cunninghamcard-bit/acard-ui/components/input"
	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo/plugins/terminal"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/appearance"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/shortcuts"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

const (
	// ID is the plugin's and its type's; Kind the tab kind
	// (TERMINAL_VIEW_TYPE).
	ID   = "terminal-ui"
	Kind = "terminal"

	// configFile is the Terminal settings' file.
	configFile = "terminal"
)

// Plugin is the terminal while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "slots", "tabTypes", "workspace", "actions", "settings", "shortcuts", "appearance"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh  *shell.Shell
			sl  *slots.Registry
			tt  *tabtypes.Registry
			ws  *workspace.Workspace
			act *actions.Service
			set *settings.Settings
			sc  *shortcuts.Shortcuts
			app *appearance.Appearance
		)
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		if err := rctx.Use("slots", &sl); err != nil {
			return err
		}
		if err := rctx.Use("tabTypes", &tt); err != nil {
			return err
		}
		if err := rctx.Use("workspace", &ws); err != nil {
			return err
		}
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		if err := rctx.Use("settings", &set); err != nil {
			return err
		}
		if err := rctx.Use("shortcuts", &sc); err != nil {
			return err
		}
		if err := rctx.Use("appearance", &app); err != nil {
			return err
		}
		set.Load(configFile)
		off := Register(sh, sl, tt, ws, act, set, sc, app)
		rctx.Effect(func(context.Context) error { off(); return nil })
		return nil
	},
})

// session is a tab's shell: its terminal, or why there is none.
type session struct {
	term     *terminal.Terminal
	starting bool
	err      string
	exited   bool
	code     int
	dir      string
	themed   *terminal.Terminal
	themeGen int
	// setTitle renames the tab, from the last frame's props.
	setTitle func(string)
}

// Terminals are the tabs' sessions, on the main thread only.
type Terminals struct {
	sh       *shell.Shell
	ws       *workspace.Workspace
	set      *settings.Settings
	sc       *shortcuts.Shortcuts
	app      *appearance.Appearance
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
	if t.ws == nil {
		return
	}
	if dir == "" {
		dir = t.defaultDir()
	}
	t.pending = dir
	_ = t.ws.OpenResource(t.address(), workspace.OpenOptions{Kind: Kind, NewTab: true})
}

// start runs a shell for s off the main thread (TerminalService.spawnInto).
func (t *Terminals) start(id int, s *session) {
	if s.starting {
		return
	}
	s.starting, s.err, s.exited = true, "", false
	var cfgShell string
	if t.set != nil {
		t.set.Get(configFile, "shell", &cfgShell)
	}
	font := t.font()
	dir := s.dir
	go func() {
		term, err := terminal.New(terminal.Options{
			Command: resolveShell(cfgShell),
			Dir:     dir,
			Font:    font,
			OnTitle: func(title string) {
				t.sh.Update(func() {
					if s.setTitle != nil && title != "" {
						s.setTitle(title)
					}
				})
			},
			OnExit: func(code int) {
				t.sh.Update(func() { s.exited, s.code = true, code })
			},
		})
		t.sh.Update(func() {
			s.starting = false
			if t.sessions[id] != s {
				if term != nil {
					_ = term.Close()
				}
				return
			}
			if err != nil {
				debugf("terminal: %v", err)
				s.err = err.Error()
				return
			}
			debugf("terminal: started in %s", dir)
			s.term, s.err, s.exited = term, "", false
		})
	}()
}

// get is tab id's session, its shell started on first sight.
func (t *Terminals) get(id int) *session {
	s, ok := t.sessions[id]
	if !ok {
		dir := t.pending
		t.pending = ""
		if dir == "" {
			dir = t.defaultDir()
		}
		s = &session{dir: dir}
		t.sessions[id] = s
		t.start(id, s)
	}
	return s
}

// body is TerminalView: the terminal, or why there is none; once its
// shell exited, a Restart.
func (t *Terminals) body(c *ui.Context, p tabtypes.Props) {
	id := p.Info.ID
	s := t.get(id)
	s.setTitle = p.SetTitle
	th := c.Theme()
	ui.Column(c).Grow(1).Fill().Children(func() {
		if s.err != "" {
			ui.Column(c).Grow(1).Fill().Center().Gap(8).Children(func() {
				ui.Text(c, "Terminal unavailable").FontWeight(600)
				ui.Text(c, s.err).FontSize(12).TextColor(th.TextMuted)
				if button.Button(c, button.ButtonProps{Variant: button.ButtonSecondary, LabelKey: "Retry",
					Children: func() { ui.Text(c, "Retry") }}).Clicked() {
					t.start(id, s)
				}
			})
			return
		}
		if s.exited {
			ui.Row(c).Padding(6, 12).Gap(8).AlignItems(ui.Center).Background(th.Surface).BorderWidth(0, 0, 1, 0).BorderColor(th.Border).Children(func() {
				ui.Text(c, fmt.Sprintf("Shell exited with code %d.", s.code)).FontSize(12).Grow(1)
				if button.Button(c, button.ButtonProps{Variant: button.ButtonSecondary, LabelKey: "Restart",
					Children: func() { ui.Text(c, "Restart") }}).Clicked() {
					if s.term != nil {
						_ = s.term.Close()
						s.term = nil
					}
					t.start(id, s)
				}
			})
		}
		if s.term == nil {
			textdoc.Centered(c, "Starting…")
			return
		}
		if gen := t.app.Generation(); s.themed != s.term || s.themeGen != gen {
			s.term.SetTheme(t.app.Terminal(false), t.app.Terminal(true))
			s.themed, s.themeGen = s.term, gen
		}
		view := terminal.View(c, s.term).Key(fmt.Sprintf("term-%d", id)).Grow(1).Fill()
		if p.Info.Focused && !s.exited {
			view.AutoFocus()
		}
		if view.Focused() && t.sc != nil {
			t.sc.SetCapture(true)
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

// defaultDir is the active file's folder, else the home folder (the TS
// defaultCwd is the vault's; the reader has no one folder).
func (t *Terminals) defaultDir() string {
	if t.ws != nil {
		if info, ok := t.ws.ActiveTab(); ok && info.Path != "" {
			return filepath.Dir(info.Path)
		}
	}
	home, _ := os.UserHomeDir()
	return home
}

// font is the Terminal settings' font.
func (t *Terminals) font() terminal.Font {
	var f terminal.Font
	if t.set != nil {
		t.set.Get(configFile, "fontFamily", &f.Family)
		t.set.Get(configFile, "fontSize", &f.Size)
	}
	return f
}

// settingTab is TerminalSettingTab: the shell, the font.
func (t *Terminals) settingTab(c *ui.Context) {
	aui.SettingsSection(c, "Terminal", func() {
		aui.PreferenceRow(c, "Shell", "The program a new terminal runs, with its arguments; empty for your login shell.", func() {
			var cur string
			t.set.Get(configFile, "shell", &cur)
			v := cur
			ui.Column(c).Width(220).Children(func() {
				input.Input(c, &v, input.InputProps{Placeholder: "login shell"}).Label("Shell")
			})
			if v != cur {
				t.set.Set(configFile, "shell", v)
			}
		})
		aui.PreferenceRow(c, "Font family", "A font family, or a comma-separated list; empty for the system's monospaced font.", func() {
			var cur string
			t.set.Get(configFile, "fontFamily", &cur)
			v := cur
			ui.Column(c).Width(220).Children(func() {
				input.Input(c, &v, input.InputProps{Placeholder: "monospace"}).Label("Font family")
			})
			if v != cur {
				t.set.Set(configFile, "fontFamily", v)
			}
		})
		aui.PreferenceRow(c, "Font size", "In points; empty for 13.", func() {
			var size float32
			t.set.Get(configFile, "fontSize", &size)
			cur := ""
			if size > 0 {
				cur = strconv.FormatFloat(float64(size), 'f', -1, 32)
			}
			v := cur
			ui.Column(c).Width(80).Children(func() {
				input.Input(c, &v, input.InputProps{Placeholder: "13"}).Label("Font size")
			})
			if v != cur {
				if n, err := strconv.ParseFloat(v, 32); err == nil && n > 0 {
					t.set.Set(configFile, "fontSize", float32(n))
				} else if v == "" {
					t.set.Unset(configFile, "fontSize")
				}
			}
		})
	})
}

// Register adds the terminal tab type, its command and settings tab until
// off is called.
func Register(sh *shell.Shell, sl *slots.Registry, tt *tabtypes.Registry, ws *workspace.Workspace, act *actions.Service, set *settings.Settings, sc *shortcuts.Shortcuts, app *appearance.Appearance) (off func()) {
	t := &Terminals{sh: sh, ws: ws, set: set, sc: sc, app: app, sessions: map[int]*session{}}
	openHere := func() { t.open("") }
	offs := []func(){
		tt.Register(tabtypes.TabType{ID: ID, Kind: Kind, Priority: tabtypes.Builtin,
			Patterns: []string{"attention://terminal/*"}, Title: title, Icon: icon.SquareTerminal.SVG(),
			Body: t.body, Closed: t.closed}),
		act.Add(actions.Command{ID: "terminal:open", Title: "Open terminal", Keys: "Ctrl J", Main: openHere, CLI: true,
			Run: func(ctx context.Context, a actions.Args) (string, error) {
				dir := a.Params["path"]
				if dir != "" && !filepath.IsAbs(dir) {
					dir = filepath.Join(a.Cwd, dir)
				}
				return shell.OnMain(ctx, sh, func() (string, error) { t.open(dir); return "Opened terminal", nil })
			}}),
		sl.RegisterSettingsSection(slots.SettingsSection{ID: "terminal", Title: "Terminal", Icon: icon.SquareTerminal.SVG(),
			Group: slots.CorePlugins, Keywords: []string{"Shell", "Copy and paste", "Font family", "Font size"}, View: t.settingTab}),
	}
	return func() {
		for i := len(offs) - 1; i >= 0; i-- {
			offs[i]()
		}
		sh.Update(func() {
			for id := range t.sessions {
				t.closed(id)
			}
		})
	}
}

// resolveShell returns the Shell setting's args, else the login shell from
// the user database rather than an inherited $SHELL (as Alacritty), else nil
// for mygo's own.
func resolveShell(cmd string) []string {
	if fields := strings.Fields(cmd); len(fields) > 0 {
		return fields
	}
	if sh := loginShell(); sh != "" {
		return []string{sh, "-l"}
	}
	return nil
}

func loginShell() string {
	u, err := user.Current()
	if err != nil {
		return ""
	}
	entry := ""
	if data, err := os.ReadFile("/etc/passwd"); err == nil {
		for line := range strings.Lines(string(data)) {
			if f := strings.Split(strings.TrimSpace(line), ":"); len(f) == 7 && f[2] == u.Uid {
				entry = line
				break
			}
		}
	}
	if entry == "" {
		out, err := exec.Command("getent", "passwd", u.Uid).Output()
		if err != nil {
			return ""
		}
		entry = string(out)
	}
	f := strings.Split(strings.TrimSpace(entry), ":")
	if len(f) != 7 {
		return ""
	}
	if st, err := os.Stat(f[6]); err != nil || st.IsDir() || st.Mode()&0o111 == 0 {
		return ""
	}
	return f[6]
}

// title is a terminal's until its program sets one.
func title(string) string { return "Terminal" }

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
