// Adapted from github.com/dimetron/pi-go internal/tui — Phase 2 RPC adapter.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"iter"
	"os/exec"
	"strings"
	"sync"
	"time"

	adkmodel "google.golang.org/adk/model"
	"google.golang.org/adk/session"
	"google.golang.org/genai"
)

// rpcAgent is an AgentBackend that drives a spawned `along --mode rpc` kernel.
//
// The kernel speaks the bidirectional JSON-line rpc protocol
// (internal/mode/rpc/server.go): JSON-line commands on stdin, JSON-line
// responses and lifecycle events on stdout. This adapter spawns the kernel,
// pumps its stdout through a single reader goroutine, and translates the
// orchestrator event stream into the ADK *session.Event shapes pi-go's
// unchanged render path (internal/tui/agent_loop.go) consumes.
//
// Event routing. The kernel's event stream is a single GLOBAL subscriber feed,
// not keyed by prompt id (server.go:81 subscribes once for all output). The
// kernel runs one turn at a time, so the adapter scopes a prompt's events
// between submitting the `prompt` command and the turn-closing `settled` event,
// routing every line to the one currently-active turn. Responses carry the
// request id and are matched back to their waiters.
type rpcAgent struct {
	cmd *exec.Cmd

	// ResolvedModel/ResolvedProvider are captured from get_state at startup so
	// main can populate the status bar / sidebar.
	ResolvedModel    string
	ResolvedProvider string

	// resolvedSessionID is the kernel's current session id from get_state.
	resolvedSessionID string

	mu      sync.Mutex
	enc     *json.Encoder // guarded by mu; serializes stdin command writes
	nextID  int
	pending map[string]chan rpcResponse // request id -> response waiter
	turn    *turnState                  // currently-active prompt turn, if any

	closed   chan struct{}
	closeErr error
	closeMu  sync.Mutex
}

// turnState is the per-prompt event sink. translated *session.Events flow to
// events; the iterator drains it until the turn closes (settled/agent_end) or a
// fatal error arrives.
type turnState struct {
	id     string
	events chan rpcYield
	done   chan struct{}
	once   sync.Once

	// toolNames maps a toolCallId to its toolName so a tool_execution_end can be
	// matched to its start by id — parallel same-name calls don't cross results.
	toolNames map[string]string
}

// rpcYield is one (event, error) pair the iterator forwards to pi-go.
type rpcYield struct {
	event *session.Event
	err   error
}

// rpcResponse is a decoded command response line.
type rpcResponse struct {
	Success bool
	Error   string
	Data    json.RawMessage
}

// --- wire types (subset of internal/mode/rpc shapes we consume) ---

type wireEnvelope struct {
	Type    string `json:"type"`
	ID      string `json:"id"`
	Command string `json:"command"`
	Success bool   `json:"success"`
	Error   string `json:"error"`
	// data is captured lazily for responses.
	Data json.RawMessage `json:"data"`

	// message_update fields.
	AssistantMessageEvent *wireAssistantEvent `json:"assistantMessageEvent"`

	// tool_execution_* fields.
	ToolCallID string          `json:"toolCallId"`
	ToolName   string          `json:"toolName"`
	Args       map[string]any  `json:"args"`
	Result     json.RawMessage `json:"result"`
	IsError    bool            `json:"isError"`
}

// wireAssistantEvent is the message_update.assistantMessageEvent union member we
// care about: text_delta / thinking_delta carry the incremental chunk in Delta.
type wireAssistantEvent struct {
	Type  string `json:"type"`
	Delta string `json:"delta"`
}

// wireGetState is the get_state response data we read.
type wireGetState struct {
	Model     *wireModel `json:"model"`
	SessionID string     `json:"sessionId"`
}

type wireModel struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
}

// wireGetCommands is the get_commands response data we read. Each command
// carries a source ("extension"/"prompt"/"skill"); skills are the entries with
// source=="skill".
type wireGetCommands struct {
	Commands []wireCommand `json:"commands"`
}

type wireCommand struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Source      string `json:"source"`
}

// wireToolResult mirrors internal/tool.Result on the wire. tool.Result has NO
// json tags, so its fields marshal with their Go names (Content/Details/
// IsError); the nested ContentBlock keeps its own lower-case tags (type/text).
type wireToolResult struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"Content"`
	IsError bool `json:"IsError"`
}

// NewRPCAgent spawns `alongPath --mode rpc`, starts the stdout reader, and
// captures the resolved model/provider/session via an initial get_state.
func NewRPCAgent(alongPath string) (*rpcAgent, error) {
	cmd := exec.Command(alongPath, "--mode", "rpc")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("rpc: stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("rpc: stdout pipe: %w", err)
	}
	// Leave stderr attached to the parent's so kernel diagnostics surface.
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("rpc: start %q: %w", alongPath, err)
	}

	a := &rpcAgent{
		cmd:     cmd,
		enc:     json.NewEncoder(stdin),
		pending: make(map[string]chan rpcResponse),
		closed:  make(chan struct{}),
	}

	go a.readLoop(stdout)

	// Resolve model/provider/session from the kernel's current state.
	resp, err := a.request("get_state", map[string]any{})
	if err != nil {
		_ = a.Close()
		return nil, fmt.Errorf("rpc: get_state: %w", err)
	}
	if !resp.Success {
		_ = a.Close()
		return nil, fmt.Errorf("rpc: get_state failed: %s", resp.Error)
	}
	var state wireGetState
	if err := json.Unmarshal(resp.Data, &state); err != nil {
		_ = a.Close()
		return nil, fmt.Errorf("rpc: decode get_state: %w", err)
	}
	if state.Model != nil {
		a.ResolvedModel = state.Model.ID
		a.ResolvedProvider = state.Model.Provider
	}
	a.resolvedSessionID = state.SessionID

	return a, nil
}

// readLoop scans the kernel's stdout JSON-lines, fanning responses to their
// waiters and translated events to the active turn. It runs until stdout closes
// (kernel death), at which point it fails any in-flight waiters/turns.
func (a *rpcAgent) readLoop(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	// Tool results (e.g. large bash output) can exceed bufio's default 64KB
	// line cap; raise the ceiling so long event lines decode intact.
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var env wireEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue // ignore unparseable lines
		}
		if env.Type == "response" {
			a.deliverResponse(env)
			continue
		}
		a.handleEvent(env)
	}

	// stdout closed: kernel exited. Surface to anyone waiting.
	err := scanner.Err()
	if err == nil {
		err = io.EOF
	}
	a.shutdown(fmt.Errorf("rpc: kernel stream ended: %w", err))
}

// deliverResponse routes a response line to its id-keyed waiter.
func (a *rpcAgent) deliverResponse(env wireEnvelope) {
	a.mu.Lock()
	ch := a.pending[env.ID]
	delete(a.pending, env.ID)
	turn := a.turn
	a.mu.Unlock()

	if ch != nil {
		ch <- rpcResponse{Success: env.Success, Error: env.Error, Data: env.Data}
		return
	}
	// A prompt that fails preflight answers via its response, not the event
	// stream. If it belongs to the active turn, surface it as a fatal error.
	if !env.Success && env.Command == "prompt" && turn != nil && turn.id == env.ID {
		turn.fail(fmt.Errorf("rpc: prompt failed: %s", env.Error))
	}
}

// handleEvent translates one lifecycle event for the active turn.
func (a *rpcAgent) handleEvent(env wireEnvelope) {
	a.mu.Lock()
	turn := a.turn
	a.mu.Unlock()
	if turn == nil {
		return // no active prompt; ignore stray lifecycle events
	}

	switch env.Type {
	case "message_update":
		ev := env.AssistantMessageEvent
		if ev == nil || ev.Delta == "" {
			return
		}
		switch ev.Type {
		case "text_delta":
			// pi-go agent_loop.go:389-401: a part with Text != "" and
			// Role != "thinking" is a streaming assistant chunk. Partial=true
			// keeps streamedText set so a later non-partial aggregate (which we
			// never emit) would be deduped; pi-go accumulates via Streaming +=.
			turn.send(textEvent("model", ev.Delta, true))
		case "thinking_delta":
			// pi-go agent_loop.go:385-388: a part with Text != "" and
			// Role == "thinking" is routed to handleAgentThinking.
			turn.send(textEvent("thinking", ev.Delta, true))
		}

	case "tool_execution_start":
		// pi-go agent_loop.go:402-424: a FunctionCall part renders the call.
		if turn.toolNames == nil {
			turn.toolNames = make(map[string]string)
		}
		if env.ToolCallID != "" {
			turn.toolNames[env.ToolCallID] = env.ToolName
		}
		turn.send(toolCallEvent(env.ToolCallID, env.ToolName, env.Args))

	case "tool_execution_end":
		// pi-go agent_loop.go:425-447: a FunctionResponse part renders the
		// result. Match the end to its start by toolCallId so parallel
		// same-name calls don't cross results.
		name := env.ToolName
		if name == "" {
			name = turn.toolNames[env.ToolCallID]
		}
		text, isErr := extractToolResultText(env.Result)
		if env.IsError {
			isErr = true
		}
		turn.send(toolResultEvent(env.ToolCallID, name, text, isErr))

	case "agent_end", "settled":
		// Turn complete: end the iterator (pi-go treats iterator end as done).
		// agent_end fires first and carries the final messages; settled is the
		// backstop. Either closes the turn.
		turn.close()
	}
}

// --- AgentBackend ---

// RunStreaming submits a prompt and returns an iterator over translated events.
func (a *rpcAgent) RunStreaming(ctx context.Context, sessionID string, userMessage string) iter.Seq2[*session.Event, error] {
	return func(yield func(*session.Event, error) bool) {
		select {
		case <-a.closed:
			yield(nil, fmt.Errorf("rpc: kernel not running"))
			return
		default:
		}

		id := a.allocID()
		ts := &turnState{
			id:        id,
			events:    make(chan rpcYield, 64),
			done:      make(chan struct{}),
			toolNames: make(map[string]string),
		}

		a.mu.Lock()
		a.turn = ts
		a.mu.Unlock()

		// Clear the active turn on exit so stray late events are ignored.
		defer func() {
			a.mu.Lock()
			if a.turn == ts {
				a.turn = nil
			}
			a.mu.Unlock()
		}()

		// Submit the prompt. The kernel answers the prompt command's response
		// asynchronously (success once preflight passes), then streams events;
		// we don't block on that response — turn closure is driven by events.
		if err := a.send(map[string]any{
			"type":    "prompt",
			"id":      id,
			"message": userMessage,
		}); err != nil {
			yield(nil, fmt.Errorf("rpc: submit prompt: %w", err))
			return
		}

		for {
			select {
			case <-ctx.Done():
				// Esc/abort: tell the kernel to cancel the active turn, then end.
				a.sendAbort()
				yield(nil, ctx.Err())
				return
			case <-a.closed:
				yield(nil, fmt.Errorf("rpc: kernel exited"))
				return
			case y, ok := <-ts.events:
				if !ok {
					return // turn closed cleanly
				}
				if !yield(y.event, y.err) {
					// Consumer stopped early (e.g. stuck-detector abort): cancel
					// the kernel turn so it doesn't keep running.
					a.sendAbort()
					return
				}
				if y.err != nil {
					return
				}
			case <-ts.done:
				// Drain any buffered events the close raced past, then end.
				for {
					select {
					case y := <-ts.events:
						if !yield(y.event, y.err) {
							a.sendAbort()
							return
						}
						if y.err != nil {
							return
						}
					default:
						return
					}
				}
			}
		}
	}
}

// CreateSession returns the kernel's current session id (from get_state). It
// never errors fatally: a missing id falls back to the passed-through default.
func (a *rpcAgent) CreateSession(ctx context.Context) (string, error) {
	if a.resolvedSessionID != "" {
		return a.resolvedSessionID, nil
	}
	// Fall back to asking the kernel to start a fresh session.
	resp, err := a.request("new_session", map[string]any{})
	if err == nil && resp.Success {
		if state, err := a.request("get_state", map[string]any{}); err == nil && state.Success {
			var s wireGetState
			if json.Unmarshal(state.Data, &s) == nil && s.SessionID != "" {
				a.resolvedSessionID = s.SessionID
				return s.SessionID, nil
			}
		}
	}
	// The kernel owns the session; an empty id is harmless for the viewer.
	return a.resolvedSessionID, nil
}

// FetchSkills asks the kernel for its commands (get_commands) and returns the
// subset that are skills (source=="skill") as []Skill. Skill commands surface
// when enableSkillCommands is true (the default). It tolerates errors and an
// empty/absent skill set by returning nil, and is bounded by a short timeout so
// startup never blocks indefinitely on a slow/unresponsive kernel.
func (a *rpcAgent) FetchSkills() []Skill {
	resp, err := a.requestTimeout("get_commands", map[string]any{}, 5*time.Second)
	if err != nil || !resp.Success || len(resp.Data) == 0 {
		return nil
	}
	var cmds wireGetCommands
	if err := json.Unmarshal(resp.Data, &cmds); err != nil {
		return nil
	}
	var skills []Skill
	for _, c := range cmds.Commands {
		if c.Source != "skill" {
			continue
		}
		skills = append(skills, Skill{
			// The kernel names skill commands "skill:<name>"; strip the prefix so
			// the dedicated Skills section shows the bare name (pi-go's intent).
			Name:        strings.TrimPrefix(c.Name, "skill:"),
			Description: c.Description,
			Source:      "user",
		})
	}
	return skills
}

// RebuildWithModel is a no-op: the kernel owns model selection.
func (a *rpcAgent) RebuildWithModel(llm adkmodel.LLM) error { return nil }

// RebuildWithInstruction is a no-op: the kernel owns the system instruction.
func (a *rpcAgent) RebuildWithInstruction(instruction string) error { return nil }

// --- command plumbing ---

func (a *rpcAgent) allocID() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.nextID++
	return fmt.Sprintf("req-%d", a.nextID)
}

// send writes one command line to the kernel's stdin.
func (a *rpcAgent) send(cmd map[string]any) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.enc == nil {
		return errors.New("rpc: encoder closed")
	}
	return a.enc.Encode(cmd)
}

// request sends a command and waits for its id-matched response.
func (a *rpcAgent) request(typ string, extra map[string]any) (rpcResponse, error) {
	id := a.allocID()
	ch := make(chan rpcResponse, 1)

	a.mu.Lock()
	a.pending[id] = ch
	a.mu.Unlock()

	cmd := map[string]any{"type": typ, "id": id}
	for k, v := range extra {
		cmd[k] = v
	}
	if err := a.send(cmd); err != nil {
		a.mu.Lock()
		delete(a.pending, id)
		a.mu.Unlock()
		return rpcResponse{}, err
	}

	select {
	case resp := <-ch:
		return resp, nil
	case <-a.closed:
		return rpcResponse{}, fmt.Errorf("rpc: kernel exited before response to %q", typ)
	}
}

// requestTimeout is request with an upper bound on how long it waits for the
// id-matched response, so a non-fatal/optional probe (e.g. get_commands at
// startup) can't wedge the boot path if the kernel is slow to answer.
func (a *rpcAgent) requestTimeout(typ string, extra map[string]any, timeout time.Duration) (rpcResponse, error) {
	id := a.allocID()
	ch := make(chan rpcResponse, 1)

	a.mu.Lock()
	a.pending[id] = ch
	a.mu.Unlock()

	cmd := map[string]any{"type": typ, "id": id}
	for k, v := range extra {
		cmd[k] = v
	}
	if err := a.send(cmd); err != nil {
		a.mu.Lock()
		delete(a.pending, id)
		a.mu.Unlock()
		return rpcResponse{}, err
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case resp := <-ch:
		return resp, nil
	case <-a.closed:
		return rpcResponse{}, fmt.Errorf("rpc: kernel exited before response to %q", typ)
	case <-timer.C:
		a.mu.Lock()
		delete(a.pending, id)
		a.mu.Unlock()
		return rpcResponse{}, fmt.Errorf("rpc: timeout waiting for response to %q", typ)
	}
}

// sendAbort best-effort cancels the active kernel turn (Esc / early stop).
func (a *rpcAgent) sendAbort() {
	_ = a.send(map[string]any{"type": "abort", "id": a.allocID()})
}

// shutdown fails every waiter and the active turn, then marks the agent closed.
func (a *rpcAgent) shutdown(cause error) {
	a.closeMu.Lock()
	select {
	case <-a.closed:
		a.closeMu.Unlock()
		return
	default:
	}
	a.closeErr = cause
	close(a.closed)
	a.closeMu.Unlock()

	a.mu.Lock()
	waiters := a.pending
	a.pending = map[string]chan rpcResponse{}
	turn := a.turn
	a.mu.Unlock()

	for _, ch := range waiters {
		select {
		case ch <- rpcResponse{Success: false, Error: cause.Error()}:
		default:
		}
	}
	if turn != nil {
		turn.fail(cause)
	}
}

// Close terminates the kernel process.
func (a *rpcAgent) Close() error {
	a.shutdown(errors.New("rpc: closed"))
	if a.cmd != nil && a.cmd.Process != nil {
		_ = a.cmd.Process.Kill()
		_ = a.cmd.Wait()
	}
	return nil
}

// --- turnState helpers ---

func (t *turnState) send(ev *session.Event) {
	select {
	case t.events <- rpcYield{event: ev}:
	case <-t.done:
	}
}

func (t *turnState) fail(err error) {
	select {
	case t.events <- rpcYield{err: err}:
	case <-t.done:
	}
	t.close()
}

func (t *turnState) close() {
	t.once.Do(func() { close(t.done) })
}

// --- *session.Event constructors (the translation table) ---

// textEvent builds a streaming text/thinking event. role is "model" for
// assistant text, "thinking" for reasoning. partial mirrors ADK streaming
// semantics so pi-go's Partial-merge accumulates deltas (agent_loop.go:390-400).
func textEvent(role, text string, partial bool) *session.Event {
	ev := &session.Event{}
	ev.Author = "model"
	ev.Partial = partial
	ev.Content = &genai.Content{
		Role:  role,
		Parts: []*genai.Part{{Text: text}},
	}
	return ev
}

// toolCallEvent builds a FunctionCall event (agent_loop.go:402-413).
func toolCallEvent(id, name string, args map[string]any) *session.Event {
	ev := &session.Event{}
	ev.Author = "model"
	ev.Content = &genai.Content{
		Role: "model",
		Parts: []*genai.Part{{
			FunctionCall: &genai.FunctionCall{ID: id, Name: name, Args: args},
		}},
	}
	return ev
}

// toolResultEvent builds a FunctionResponse event (agent_loop.go:425-433). The
// human-readable text from the tool's Content[].Text is placed under "output";
// on error it is also placed under "error" so pi-go's error-streak check
// (agent_loop.go:437) and toolResultSummary render correctly.
func toolResultEvent(id, name, text string, isErr bool) *session.Event {
	// pi-go's formatToolResult (tool_display.go:506) returns data["content"]
	// verbatim, so the readable text renders cleanly. The previous "output" key
	// matched no formatter branch and fell through to the compact-JSON fallback
	// (tool_display.go:573), leaking a {"output":"..."} envelope into the chat.
	// On error also set "error" so pi-go's stuck-error detector fires
	// (agent_loop.go:386, a key-existence check) while "content" still renders.
	resp := map[string]any{"content": text}
	if isErr {
		resp["error"] = text
	}
	ev := &session.Event{}
	ev.Author = "model"
	ev.Content = &genai.Content{
		// "tool" role: not "model"/"thinking", so pi-go resets streamedText for
		// the next turn segment (agent_loop.go:381).
		Role: "tool",
		Parts: []*genai.Part{{
			FunctionResponse: &genai.FunctionResponse{ID: id, Name: name, Response: resp},
		}},
	}
	return ev
}

// extractToolResultText pulls the concatenated human-readable text out of a
// tool.Result's Content[].Text. It deliberately does NOT forward the raw
// {Content:...} envelope. Returns the text and whether the result is an error.
func extractToolResultText(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var res wireToolResult
	if err := json.Unmarshal(raw, &res); err != nil {
		// Unexpected shape: surface the raw payload rather than dropping it.
		return string(raw), false
	}
	var out string
	for i, c := range res.Content {
		if c.Type != "" && c.Type != "text" {
			continue
		}
		if i > 0 && out != "" {
			out += "\n"
		}
		out += c.Text
	}
	return out, res.IsError
}
