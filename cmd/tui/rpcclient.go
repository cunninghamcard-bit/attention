package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"sync"
)

// RPCClient spawns the Attention kernel (`along --mode rpc`) as a child process
// and speaks its newline-delimited JSON protocol: one JSON command object per
// line on the child's stdin, one JSON event/response object per line on stdout.
//
// The wire shapes mirrored below are taken verbatim from the kernel's
// serializers:
//   - Attention/internal/mode/rpc/rpc.go  (event JSON envelopes, lines 81-230)
//   - Attention/internal/mode/rpc/server.go (command + response shapes)
//   - Attention/internal/ai/types.go       (ai.Message / ContentBlock)
type RPCClient struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser

	encMu sync.Mutex // guards enc; the kernel reads one command per line
	enc   *json.Encoder

	Events <-chan Event // typed events parsed from the child's stdout

	nextID int
	idMu   sync.Mutex
}

// ---- Wire types (subset; only what the viewer consumes) --------------------

// contentBlock mirrors ai.ContentBlock (ai/types.go:14-31). Only the fields the
// viewer reads are kept; unknown fields are ignored by encoding/json.
type contentBlock struct {
	Type     string `json:"type"` // "text" | "thinking" | "toolCall" | "image"
	Text     string `json:"text,omitempty"`
	Thinking string `json:"thinking,omitempty"`
	ToolName string `json:"name,omitempty"`
}

// aiMessage mirrors ai.Message (ai/types.go:43-62).
type aiMessage struct {
	Role    string         `json:"role"` // "user" | "assistant" | "toolResult"
	Content []contentBlock `json:"content,omitempty"`
}

// text concatenates all text content blocks of a message.
func (m *aiMessage) text() string {
	if m == nil {
		return ""
	}
	var out string
	for _, b := range m.Content {
		if b.Type == "text" {
			out += b.Text
		}
	}
	return out
}

// assistantMessageEvent is the nested streaming delta carried by message_update
// (rpc.go:198-217, mapAssistantMessageEvent rpc.go:244-285). delta is the
// incremental text/thinking string for *_delta variants.
type assistantMessageEvent struct {
	Type  string `json:"type"` // "text_delta" | "thinking_delta" | "text_start" | ...
	Delta string `json:"delta"`
}

// rawEvent is the flat decode target for every stdout line. Fields not present
// for a given event type stay zero.
type rawEvent struct {
	Type string `json:"type"`

	// message_update (rpc.go:198-202)
	AssistantMessageEvent *assistantMessageEvent `json:"assistantMessageEvent"`

	// message_start / message_end / message_update / turn_end (rpc.go:90-99,326-328)
	Message *aiMessage `json:"message"`

	// agent_end (rpc.go:85-88)
	Messages []aiMessage `json:"messages"`

	// tool_execution_start / _end (rpc.go:101-122)
	ToolCallID string          `json:"toolCallId"`
	ToolName   string          `json:"toolName"`
	Args       json.RawMessage `json:"args"`
	Result     json.RawMessage `json:"result"`
	IsError    bool            `json:"isError"`

	// response (server.go:210-218)
	Command string `json:"command"`
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

// ---- Typed events delivered to the TUI -------------------------------------

// EventKind enumerates the viewer-relevant subset of the protocol.
type EventKind int

const (
	EvOther EventKind = iota
	EvSession
	EvAssistantTextDelta
	EvThinkingDelta
	EvMessageEnd // assistant message committed (message_end / turn_end)
	EvToolStart
	EvToolEnd
	EvAgentEnd // run finished (agent_end)
	EvSettled
	EvResponse // ack of a command (e.g. prompt)
	EvKernelExit
	EvError // transport/decode error
)

// Event is the typed message forwarded on RPCClient.Events.
type Event struct {
	Kind       EventKind
	Text       string // delta text, committed assistant text, or error text
	ToolName   string
	ToolArgs   string // pretty one-line args (for EvToolStart)
	ToolResult string // result summary (for EvToolEnd)
	IsError    bool
}

// NewRPCClient spawns `alongPath --mode rpc --model <model> --api-key <key>`
// and starts a background reader that forwards typed events on c.Events.
// The caller owns shutdown via Close.
func NewRPCClient(alongPath, model, apiKey string) (*RPCClient, error) {
	args := []string{"--mode", "rpc", "--model", model}
	if apiKey != "" {
		args = append(args, "--api-key", apiKey)
	}
	cmd := exec.Command(alongPath, args...)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	// Let the kernel's stderr surface diagnostics on our own stderr; the TUI
	// owns the alternate screen so this stays out of the rendered view.
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start %s: %w", alongPath, err)
	}

	ch := make(chan Event, 256)
	c := &RPCClient{
		cmd:    cmd,
		stdin:  stdin,
		stdout: stdout,
		enc:    json.NewEncoder(stdin),
		Events: ch,
	}
	go c.readLoop(ch)
	return c, nil
}

// readLoop reads one JSON line per iteration, decodes the envelope, and forwards
// a typed Event. A large buffer accommodates big tool results on one line.
func (c *RPCClient) readLoop(ch chan<- Event) {
	defer close(ch)
	sc := bufio.NewScanner(c.stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev rawEvent
		if err := json.Unmarshal(line, &ev); err != nil {
			ch <- Event{Kind: EvError, Text: "decode: " + err.Error()}
			continue
		}
		ch <- classify(&ev)
	}
	// Stdout closed: the kernel exited.
	_ = c.cmd.Wait()
	ch <- Event{Kind: EvKernelExit}
}

// classify maps a decoded rawEvent onto the viewer's typed Event.
func classify(ev *rawEvent) Event {
	switch ev.Type {
	case "session":
		return Event{Kind: EvSession}

	case "message_update":
		if a := ev.AssistantMessageEvent; a != nil {
			switch a.Type {
			case "text_delta":
				return Event{Kind: EvAssistantTextDelta, Text: a.Delta}
			case "thinking_delta":
				return Event{Kind: EvThinkingDelta, Text: a.Delta}
			}
		}
		return Event{Kind: EvOther}

	case "message_end", "turn_end":
		// Commit the assistant text from the finalized message's content blocks.
		return Event{Kind: EvMessageEnd, Text: ev.Message.text()}

	case "tool_execution_start":
		return Event{
			Kind:     EvToolStart,
			ToolName: ev.ToolName,
			ToolArgs: oneLineJSON(ev.Args),
		}

	case "tool_execution_end":
		return Event{
			Kind:       EvToolEnd,
			ToolName:   ev.ToolName,
			ToolResult: resultSummary(ev.Result),
			IsError:    ev.IsError,
		}

	case "agent_end":
		return Event{Kind: EvAgentEnd}

	case "settled":
		return Event{Kind: EvSettled}

	case "response":
		// Ack of a command (prompt preflight, etc.). Surface failures as errors.
		if !ev.Success && ev.Error != "" {
			return Event{Kind: EvError, Text: ev.Command + ": " + ev.Error}
		}
		return Event{Kind: EvResponse, Text: ev.Command}

	default:
		return Event{Kind: EvOther}
	}
}

// SendPrompt writes a prompt command: {"id":..,"type":"prompt","message":text}.
// The encoder is mutex-guarded so concurrent sends never interleave a line.
func (c *RPCClient) SendPrompt(text string) error {
	c.idMu.Lock()
	c.nextID++
	id := fmt.Sprintf("p%d", c.nextID)
	c.idMu.Unlock()

	cmd := map[string]any{
		"id":      id,
		"type":    "prompt",
		"message": text,
	}
	c.encMu.Lock()
	defer c.encMu.Unlock()
	return c.enc.Encode(cmd) // json.Encoder appends the newline delimiter
}

// Close ends the session. Closing stdin makes the kernel's command reader hit
// EOF and shut down cleanly (server.go:137); Kill is the backstop.
func (c *RPCClient) Close() {
	if c.stdin != nil {
		_ = c.stdin.Close()
	}
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
	}
}

// oneLineJSON renders tool args (an arbitrary JSON value) as a compact,
// single-line string for the tool header.
func oneLineJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return collapseToSingleLine(string(raw))
	}
	b, err := json.Marshal(v)
	if err != nil {
		return collapseToSingleLine(string(raw))
	}
	return collapseToSingleLine(string(b))
}

// resultSummary renders a tool result (string, object, or array) to a short
// human-readable line. Reuses the copied tool_display summarizer when the
// result is a JSON object, matching pi-go's rendering of structured results.
func resultSummary(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	// String result: use as-is.
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	// Object result: defer to the copied toolResultSummary (tool_display.go).
	return toolResultSummary(string(raw))
}
