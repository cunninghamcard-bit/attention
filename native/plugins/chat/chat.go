// Package chat is the Chat tab: threads with dim, the main AI, over its
// App Server (issue #8, RFC 0006 §7). A thread is a dim session in a
// project's folder; asking about a selection quotes it into the thread
// beside the text.
package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/internal/dim"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/appearance"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
)

const (
	// ID is the plugin's name and its tab type's ID.
	ID = "chat-ui"
	// Kind is the Chat tab's kind.
	Kind = "chat"
	// AddressPrefix starts a thread's tab address; the thread's ID ends it.
	AddressPrefix = "attention://chat/"
	threadsSource = "chat-threads"
	callTimeout   = 30 * time.Second
)

// Plugin is the Chat tab while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "slots", "tabTypes", "workspace", "actions", "appearance"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh  *shell.Shell
			sl  *slots.Registry
			tt  *tabtypes.Registry
			ws  *workspace.Workspace
			act *actions.Service
			app *appearance.Appearance
		)
		for name, dst := range map[string]any{"shell": &sh, "slots": &sl, "tabTypes": &tt, "workspace": &ws, "actions": &act, "appearance": &app} {
			if err := rctx.Use(name, dst); err != nil {
				return err
			}
		}
		threads, err := load(StorePath())
		if err != nil {
			fmt.Fprintln(os.Stderr, "attention:", err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		ch := New(ctx, sh.Update, ws, tt, app, threads, StorePath())
		off := ch.Register(sh, sl, act)
		rctx.Effect(func(context.Context) error {
			off()
			ch.agent.close()
			cancel()
			return nil
		})
		return nil
	},
})

// Chat is the threads and their tabs' state, on the main thread only.
type Chat struct {
	ctx   context.Context
	post  func(func())
	ws    *workspace.Workspace
	tt    *tabtypes.Registry
	app   *appearance.Appearance
	path  string
	agent *agent

	threads []*Thread
	live    map[string]*live
	saving  chan []Thread
}

// New is the chat over threads, saved at path, posting work back with post.
func New(ctx context.Context, post func(func()), ws *workspace.Workspace, tt *tabtypes.Registry, app *appearance.Appearance, threads []*Thread, path string) *Chat {
	ch := &Chat{ctx: ctx, post: post, ws: ws, tt: tt, app: app, path: path, threads: threads, live: map[string]*live{}, saving: make(chan []Thread, 1)}
	ch.agent = &agent{
		notify: func(n dim.Notice) { post(func() { ch.notice(n) }) },
		gone:   func() { post(ch.disconnected) },
	}
	go ch.saver()
	return ch
}

// Register adds the Chat tab type, its commands, the thread list and the
// selection bar until off is called.
func (ch *Chat) Register(sh *shell.Shell, sl *slots.Registry, act *actions.Service) (off func()) {
	offs := []func(){
		ch.tt.Register(tabtypes.TabType{
			ID: ID, Kind: Kind, Priority: tabtypes.Builtin,
			Patterns: []string{AddressPrefix + "*"},
			Title:    ch.title,
			Icon:     icon.MessageCircle.SVG(),
			Body:     ch.body,
			Closed:   func(int) {},
		}),
		sl.RegisterPaletteSource(slots.PaletteSource{ID: threadsSource, Placeholder: "Open a thread…", Items: ch.threadItems,
			Empty: func(string) string { return "No threads yet" }}),
		sl.RegisterOverlay(slots.Overlay{ID: "chat-selection-bar", Order: 5, View: ch.selectionBar}),
	}
	cmd := func(id, title, keys string, fn func()) actions.Command {
		return actions.Command{ID: id, Title: title, Keys: keys, Main: fn, Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, sh, func() (string, error) { fn(); return "", nil })
		}}
	}
	for _, c := range []actions.Command{
		cmd("chat:new-thread", "New thread", "", func() { ch.openThread(ch.newThread(ch.activeCwd()), false) }),
		cmd("chat:open-thread", "Open thread…", "", func() { sl.OpenPalette(threadsSource) }),
		cmd("chat:ask-selection", "Ask about selection", "Ctrl Shift L", func() { ch.askSelection(true) }),
		{ID: "chat:ask", CLI: true, Run: func(ctx context.Context, a actions.Args) (string, error) {
			return shell.OnMain(ctx, sh, func() (string, error) { return ch.ask(a.Params["text"]) })
		}},
	} {
		offs = append(offs, act.Add(c))
	}
	return func() {
		for _, o := range slices.Backward(offs) {
			o()
		}
	}
}

// thread is the thread with id, nil when none.
func (ch *Chat) thread(id string) *Thread {
	for _, t := range ch.threads {
		if t.ID == id {
			return t
		}
	}
	return nil
}

// title is a Chat tab's title: its thread's, else New thread.
func (ch *Chat) title(address string) string {
	if t := ch.thread(strings.TrimPrefix(address, AddressPrefix)); t != nil && t.Title != "" {
		return t.Title
	}
	return "New thread"
}

// newThread starts a thread in cwd; its dim session is made when the
// first message is sent.
func (ch *Chat) newThread(cwd string) *Thread {
	now := time.Now()
	t := &Thread{ID: newThreadID(), Cwd: cwd, Created: now, Used: now}
	ch.threads = append([]*Thread{t}, ch.threads...)
	ch.persist()
	return t
}

// projectThread is the last used thread working in cwd, else a new one.
func (ch *Chat) projectThread(cwd string) *Thread {
	var t *Thread
	for _, th := range ch.threads {
		if th.Cwd == cwd && (t == nil || th.Used.After(t.Used)) {
			t = th
		}
	}
	if t == nil {
		t = ch.newThread(cwd)
	}
	return t
}

// openThread shows t's tab, beside the active card when split, and puts
// the caret in its field.
func (ch *Chat) openThread(t *Thread, split bool) {
	ch.state(t).focus = true
	o := workspace.OpenOptions{Kind: Kind, KeepActive: true}
	var err error
	if split {
		err = ch.ws.OpenSplit(AddressPrefix+t.ID, o)
	} else {
		err = ch.ws.OpenResource(AddressPrefix+t.ID, o)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "attention: open thread:", err)
	}
}

// activeCwd is the folder a new thread works in: the active file's
// project, the active thread's folder, else the home folder.
func (ch *Chat) activeCwd() string {
	if info, ok := ch.ws.ActiveTab(); ok {
		if info.Path != "" {
			if m, ok := ch.ws.Project(info.Path); ok {
				return m.Path
			}
		}
		if t := ch.thread(strings.TrimPrefix(info.Address, AddressPrefix)); info.Kind == Kind && t != nil {
			return t.Cwd
		}
	}
	home, _ := os.UserHomeDir()
	return home
}

// state is t's live state, made on first use.
func (ch *Chat) state(t *Thread) *live {
	l, ok := ch.live[t.ID]
	if !ok {
		l = &live{thread: t, open: map[int]bool{}}
		ch.live[t.ID] = l
	}
	return l
}

// bySession is the live state of the thread on session id, nil when none
// is shown.
func (ch *Chat) bySession(id string) *live {
	for _, l := range ch.live {
		if l.thread.SessionID == id {
			return l
		}
	}
	return nil
}

// notice applies a dim notification to the thread it is about.
func (ch *Chat) notice(n dim.Notice) {
	switch n.Method {
	case dim.MethodEvent:
		var e dim.EventNotice
		if json.Unmarshal(n.Params, &e) != nil || e.BranchID != "" && e.BranchID != "main" {
			return
		}
		if l := ch.bySession(e.SessionID); l != nil {
			if l.loading {
				l.held = append(l.held, e.Event)
				return
			}
			l.apply(e.Event)
		}
	case dim.MethodProgress:
		var p dim.Progress
		if json.Unmarshal(n.Params, &p) != nil || p.BranchID != "" && p.BranchID != "main" {
			return
		}
		// Progress can trail its turn's end: only the running turn's counts.
		// Its text is what step events have not committed yet.
		if l := ch.bySession(p.SessionID); l != nil && l.running && (l.turn == "" || p.TurnID == l.turn) {
			l.stream.Text, l.stream.Thinking = p.Text, p.Thinking
		}
	case dim.MethodNotice:
		var sn dim.SessionNotice
		if json.Unmarshal(n.Params, &sn) != nil || sn.Kind != "title" {
			return
		}
		var d struct {
			Title string `json:"title"`
		}
		if json.Unmarshal(sn.Data, &d) == nil && d.Title != "" {
			for _, t := range ch.threads {
				if t.SessionID == sn.SessionID && t.Title != d.Title {
					t.Title = d.Title
					ch.persist()
				}
			}
		}
	}
}

// disconnected forgets every thread's attachment: the next frame that
// shows one connects again and reloads it.
func (ch *Chat) disconnected() {
	for _, l := range ch.live {
		if !l.loading {
			l.loaded, l.running, l.busy = false, false, false
			l.stream = dim.Message{}
		}
	}
}

// load attaches to t's session and reads its messages, off the main
// thread; events that arrive meanwhile wait in held.
func (ch *Chat) load(l *live) {
	l.loading, l.err = true, ""
	id := l.thread.SessionID
	go func() {
		ctx, cancel := context.WithTimeout(ch.ctx, callTimeout)
		defer cancel()
		var (
			events  []dim.Event
			running bool
		)
		c, err := ch.agent.conn(ctx)
		if err == nil {
			var at dim.Attached
			at, err = c.Attach(ctx, id)
			running = at.Running
		}
		for after := uint64(0); err == nil; {
			var page dim.HistoryPage
			if page, err = c.History(ctx, id, after); err != nil || page.Done || page.NextAfter <= after {
				events = append(events, page.Events...)
				break
			}
			events, after = append(events, page.Events...), page.NextAfter
		}
		ch.post(func() {
			l.loading, l.loaded = false, true
			if err != nil {
				l.err = err.Error()
				l.held = nil
				return
			}
			l.messages, l.lastSeq, l.running = dim.Messages(events), 0, running
			if len(events) > 0 {
				l.lastSeq = events[len(events)-1].Sequence
			}
			for _, e := range l.held {
				l.apply(e)
			}
			l.held = nil
		})
	}()
}

// send asks the thread text: it makes the dim session on the first
// message, then submits.
func (ch *Chat) send(l *live) {
	text := strings.TrimSpace(l.draft)
	if l.quote != "" {
		text = strings.TrimSpace(l.quote + "\n\n" + text)
	}
	if text == "" || l.busy {
		return
	}
	t := l.thread
	l.draft, l.quote, l.sent, l.busy, l.err = "", "", text, true, ""
	t.Used = time.Now()
	ch.persist()
	id, cwd := t.SessionID, t.Cwd
	go func() {
		ctx, cancel := context.WithTimeout(ch.ctx, callTimeout)
		defer cancel()
		c, err := ch.agent.conn(ctx)
		if err == nil && id == "" {
			var cr dim.Created
			if cr, err = c.Create(ctx, cwd, dim.ReadOnly); err == nil {
				id = cr.SessionID
				ch.post(func() {
					t.SessionID, l.loaded = id, true
					ch.persist()
				})
				_, err = c.Attach(ctx, id)
			}
		}
		if err == nil {
			err = c.Submit(ctx, id, text)
		}
		ch.post(func() {
			l.busy = false
			if err != nil {
				l.err, l.draft, l.sent = err.Error(), text, ""
			}
		})
	}()
}

// ask sends text, after any quote waiting, to the active thread or the
// active project's last used one, shown beside (`chat:ask text=…`).
func (ch *Chat) ask(text string) (string, error) {
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("Missing required parameter: text=<question>")
	}
	var t *Thread
	if info, ok := ch.ws.ActiveTab(); ok && info.Kind == Kind {
		t = ch.thread(strings.TrimPrefix(info.Address, AddressPrefix))
	}
	if t == nil {
		t = ch.projectThread(ch.activeCwd())
		ch.openThread(t, true)
	}
	l := ch.state(t)
	l.draft = text
	ch.send(l)
	return "Asked in " + ch.title(AddressPrefix+t.ID), nil
}

// stop ends the thread's running turn.
func (ch *Chat) stop(l *live) {
	id := l.thread.SessionID
	if id == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(ch.ctx, callTimeout)
		defer cancel()
		c, err := ch.agent.conn(ctx)
		if err == nil {
			err = c.Stop(ctx, id)
		}
		if err != nil {
			ch.post(func() { l.err = err.Error() })
		}
	}()
}

// persist saves the threads off the main thread, newest state winning.
func (ch *Chat) persist() {
	snap := make([]Thread, len(ch.threads))
	for i, t := range ch.threads {
		snap[i] = *t
	}
	select {
	case <-ch.saving:
	default:
	}
	ch.saving <- snap
}

func (ch *Chat) saver() {
	for {
		select {
		case <-ch.ctx.Done():
			return
		case snap := <-ch.saving:
			if err := save(ch.path, snap); err != nil {
				fmt.Fprintln(os.Stderr, "attention:", err)
			}
		}
	}
}

// live is a thread's state while attention shows it.
type live struct {
	thread   *Thread
	messages []dim.Message
	// stream is the running turn's output its step events have not
	// committed yet.
	stream dim.Message
	// sent is the message being submitted, shown until dim records it.
	sent    string
	draft   string
	quote   string
	running bool
	// turn is the running turn's ID, "" when unknown.
	turn    string
	busy    bool
	err     string
	loaded  bool
	loading bool
	lastSeq uint64
	held    []dim.Event
	focus   bool
	open    map[int]bool
	scroll  ui.ScrollState
}

// apply adds a committed event, once.
func (l *live) apply(e dim.Event) {
	if e.Sequence != 0 && e.Sequence <= l.lastSeq {
		return
	}
	l.lastSeq = max(l.lastSeq, e.Sequence)
	before := len(l.messages)
	l.messages = dim.Apply(l.messages, e)
	switch e.Type + "/" + e.Name {
	case "input/message":
		if len(l.messages) > before {
			l.sent = ""
		}
	case "step/text":
		l.stream.Text = ""
	case "step/thinking":
		l.stream.Thinking = ""
	case "turn/start":
		var d struct {
			TurnID string `json:"turn_id"`
		}
		_ = json.Unmarshal(e.Data, &d)
		l.running, l.turn, l.stream = true, d.TurnID, dim.Message{}
	case "turn/end":
		l.running, l.turn, l.stream = false, "", dim.Message{}
	}
}

// agent is the connection to dim, made when first needed and again after
// it drops.
type agent struct {
	notify dim.NoticeFunc
	gone   func()

	mu     sync.Mutex
	client *dim.Client
}

func (a *agent) conn(ctx context.Context) (*dim.Client, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.client != nil && a.client.Err() == nil {
		return a.client, nil
	}
	path, err := dim.SocketPath()
	if err != nil {
		return nil, err
	}
	c, err := dim.Dial(ctx, path, "attention", a.notify)
	if err != nil {
		return nil, err
	}
	a.client = c
	go func() {
		<-c.Done()
		a.gone()
	}()
	return c, nil
}

func (a *agent) close() {
	a.mu.Lock()
	c := a.client
	a.client = nil
	a.mu.Unlock()
	if c != nil {
		_ = c.Close()
	}
}
