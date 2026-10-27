// Package terminalui is the terminal (RFC 0001 roadmap P4), attention's
// terminal plugin (apps/web/builtin/terminal: TerminalPlugin.ts,
// TerminalService.ts, TerminalView.ts) over mygo's terminal, libghostty-vt
// in a pseudo-terminal: a tab per shell, the user's login shell in the
// active file's folder, Open terminal (Ctrl J), and the Terminal settings tab.
//
// While a terminal has the focus it takes the keys, but those of the
// commands in skipShell, which stay the window's, as VS Code's
// terminal.integrated.commandsToSkipShell (actionsapi.SetCapture). Its
// title is the one the program sets (OSC 0 and 2), as terminals show it.
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

const (
	// ID is the plugin's and its type's; Kind the tab kind
	// (TERMINAL_VIEW_TYPE).
	ID   = "terminal-ui"
	Kind = "terminal"

	// configFile is the Terminal settings' file.
	configFile = "terminal"
)

var (
	// skipShell are the commands whose shortcuts reach the window from a
	// focused terminal: VS Code's DEFAULT_COMMANDS_TO_SKIP_SHELL, as far as the
	// reader has them, and the tab's own Close and New tab. Ctrl G, Ctrl \ and
	// Alt with the arrows stay the shell's.
	skipShell = map[string]bool{
		"command-palette:open": true, "switcher:open": true, "global-search:open": true, "app:open-settings": true,
		"app:toggle-left-sidebar": true, "app:toggle-right-sidebar": true, "terminal:open": true, "quit": true,
		"workspace:close": true, "workspace:new-tab": true, "workspace:next-tab": true, "workspace:previous-tab": true, "workspace:undo-close-pane": true, "workspace:goto-last-tab": true,
		"workspace:goto-tab-1": true, "workspace:goto-tab-2": true, "workspace:goto-tab-3": true, "workspace:goto-tab-4": true,
		"workspace:goto-tab-5": true, "workspace:goto-tab-6": true, "workspace:goto-tab-7": true, "workspace:goto-tab-8": true,
	}

	// Plugin is the terminal while loaded.
	Plugin = rutis.Define(rutis.Plugin[struct{}]{
		Name:   ID,
		Inject: []string{"shell", "workspace"},
		Apply: func(rctx *rutis.Ctx, _ struct{}) error {
			settingsapi.Load(configFile)
			off := Register()
			rctx.Effect(func(context.Context) error { off(); return nil })
			return nil
		},
	})
)

// session is a tab's shell: its terminal, or why there is none.
type session struct {
	term   *terminal.Terminal
	err    string
	exited bool
	code   int
	dir    string
	// setTitle renames the tab, from the last frame's props.
	setTitle func(string)
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

// start runs a shell for s (TerminalService.spawnInto).
func (t *Terminals) start(s *session) {
	term, err := terminal.New(terminal.Options{
		Command:  shell(),
		Dir:      s.dir,
		Font:     font(),
		Keybinds: keybinds(),
		OnTitle: func(title string) {
			shellapi.Update(func() {
				if s.setTitle != nil && title != "" {
					s.setTitle(title)
				}
			})
		},
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
	s.setTitle = p.SetTitle
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
			actionsapi.SetCapture(skipShell)
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
			Group: slotsapi.CorePlugins, Keywords: []string{"Shell", "Copy and paste", "Font family", "Font size"}, View: settingTab}),
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

// shell is the Shell setting, else the login shell from the user database
// rather than an inherited $SHELL (as Alacritty), else nil for mygo's own.
func shell() []string {
	var cmd string
	settingsapi.Get(configFile, "shell", &cmd)
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

// keybinds are the Ctrl C and Ctrl V setting's, on by default: Ctrl C
// copies a selection and without one interrupts, as Windows Terminal.
func keybinds() []terminal.Keybind {
	on := true
	settingsapi.Get(configFile, "ctrlCopyPaste", &on)
	if !on {
		return nil
	}
	return []terminal.Keybind{
		{Mods: ui.Ctrl, Key: ui.KeyC, Action: terminal.ActionCopy, Performable: true},
		{Mods: ui.Ctrl, Key: ui.KeyV, Action: terminal.ActionPaste},
	}
}

// title is a terminal's until its program sets one.
func title(string) string { return "Terminal" }

// settingTab is TerminalSettingTab: the shell, the font.
func settingTab(c *ui.Context) {
	omgui.SettingsSection(c, "Terminal", func() {
		omgui.PreferenceRow(c, "Shell", "The program a new terminal runs, with its arguments; empty for your login shell.", func() {
			var cur string
			settingsapi.Get(configFile, "shell", &cur)
			v := cur
			omgui.Field(c, &v, "login shell", false).Width(220)
			if v != cur {
				settingsapi.Set(configFile, "shell", v)
			}
		})
		omgui.PreferenceRow(c, "Copy and paste with Ctrl C and Ctrl V",
			"Ctrl C copies the selection, and interrupts without one; Ctrl V pastes. Off: Ctrl Shift C and Ctrl Shift V only.", func() {
				on := true
				settingsapi.Get(configFile, "ctrlCopyPaste", &on)
				v := on
				ui.Switch(c, &v)
				if v != on {
					settingsapi.Set(configFile, "ctrlCopyPaste", v)
				}
			})
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

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
