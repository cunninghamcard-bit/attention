package dim

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	// MethodEvent is the notification of a session's committed event.
	MethodEvent = "session.event"
	// MethodProgress is the notification of a model's output so far.
	MethodProgress = "session.model.progress"
	// MethodNotice is the notification of a session's title and the like.
	MethodNotice = "session.notice"
	// ReadOnly is the permission preset that lets the agent read only.
	ReadOnly = "read-only"
	// User marks the user's messages.
	User Role = 0
	// Assistant marks the agent's messages.
	Assistant  Role = 1
	mainBranch      = "main"
)

// Event is one entry of a session's timeline.
type Event struct {
	ID       string          `json:"id"`
	Sequence uint64          `json:"sequence"`
	Type     string          `json:"type"`
	Name     string          `json:"name"`
	Data     json.RawMessage `json:"data"`
}

// EventNotice is a session.event notification's params.
type EventNotice struct {
	SessionID string `json:"sessionId"`
	BranchID  string `json:"branchId"`
	Event     Event  `json:"event"`
}

// Progress is a session.model.progress notification's params: the text
// and thinking of the model's current output that step events have not
// committed yet, after the offsets (in characters) they have.
type Progress struct {
	SessionID      string `json:"sessionId"`
	BranchID       string `json:"branchId"`
	TurnID         string `json:"turnId"`
	TextPartID     string `json:"textPartId"`
	Text           string `json:"text"`
	TextOffset     int    `json:"textOffset"`
	Thinking       string `json:"thinking"`
	ThinkingOffset int    `json:"thinkingOffset"`
}

// SessionNotice is a session.notice notification's params.
type SessionNotice struct {
	SessionID string          `json:"sessionId"`
	Kind      string          `json:"kind"`
	Data      json.RawMessage `json:"data"`
}

// Created is session.create's reply.
type Created struct {
	SessionID string `json:"sessionId"`
	Model     struct {
		ProviderID string `json:"providerId"`
		ModelID    string `json:"modelId"`
	} `json:"model"`
}

// Attached is the part of session.attach's reply the client reads.
type Attached struct {
	SessionID string `json:"sessionId"`
	Cwd       string `json:"cwd"`
	Running   bool   `json:"running"`
	Title     string `json:"title"`
}

// HistoryPage is one page of session.history.
type HistoryPage struct {
	Events    []Event `json:"events"`
	NextAfter uint64  `json:"nextAfter"`
	Done      bool    `json:"done"`
}

// Role is who wrote a message.
type Role int

// Message is a turn's side as a reader sees it: the user's text, or the
// assistant's text, thinking and tool calls.
type Message struct {
	Role     Role
	Text     string
	Thinking string
	Tools    []string
	Failed   bool
}

// Create starts a session in cwd with the permission preset.
func (c *Client) Create(ctx context.Context, cwd, preset string) (Created, error) {
	var out Created
	err := c.Call(ctx, "session.create", map[string]any{"cwd": cwd, "permissionPolicy": map[string]any{"preset": preset}}, &out)
	return out, err
}

// Attach makes the connection receive session id's notifications.
func (c *Client) Attach(ctx context.Context, id string) (Attached, error) {
	var out Attached
	err := c.Call(ctx, "session.attach", map[string]any{"sessionId": id}, &out)
	return out, err
}

// Submit queues text as the user's next message.
func (c *Client) Submit(ctx context.Context, id, text string) error {
	params := map[string]any{"sessionId": id, "branchId": mainBranch, "submissionId": newID(), "mode": "queue", "text": text}
	return c.Call(ctx, "session.submit", params, nil)
}

// Stop ends the running turn.
func (c *Client) Stop(ctx context.Context, id string) error {
	return c.Call(ctx, "session.stop", map[string]any{"sessionId": id, "branchId": mainBranch, "reason": "stopped in attention"}, nil)
}

// History reads the main branch's events after the sequence after.
func (c *Client) History(ctx context.Context, id string, after uint64) (HistoryPage, error) {
	params := map[string]any{"sessionId": id, "branchId": mainBranch, "limit": 256}
	if after > 0 {
		params["after"] = after
	}
	var out HistoryPage
	err := c.Call(ctx, "session.history", params, &out)
	return out, err
}

// Messages folds events into the conversation they record; Apply adds
// one event at a time.
func Messages(events []Event) []Message {
	var ms []Message
	for _, e := range events {
		ms = Apply(ms, e)
	}
	return ms
}

// Apply adds e to ms: a user's message starts one, a step's text,
// thinking or tool call extends the assistant's, a failed turn marks it.
func Apply(ms []Message, e Event) []Message {
	assistant := func() *Message {
		if len(ms) == 0 || ms[len(ms)-1].Role != Assistant {
			ms = append(ms, Message{Role: Assistant})
		}
		return &ms[len(ms)-1]
	}
	switch e.Type + "/" + e.Name {
	case "input/message":
		if text := userText(e.Data); text != "" {
			ms = append(ms, Message{Role: User, Text: text})
		}
	case "step/text":
		var d struct {
			Delta string `json:"delta"`
		}
		if json.Unmarshal(e.Data, &d) == nil && d.Delta != "" {
			assistant().Text += d.Delta
		}
	case "step/thinking":
		var d struct {
			Delta string `json:"delta"`
		}
		if json.Unmarshal(e.Data, &d) == nil && d.Delta != "" {
			assistant().Thinking += d.Delta
		}
	case "step/tool-use-start", "step/tool-call":
		if name := toolName(e.Data); name != "" {
			m := assistant()
			m.Tools = append(m.Tools, name)
		}
	case "turn/end":
		var d struct {
			Status string `json:"status"`
		}
		if json.Unmarshal(e.Data, &d) == nil && d.Status == "failed" {
			assistant().Failed = true
		}
	}
	return ms
}

// userText is the text the user typed in an input/message event; dim's
// own state blocks (data.blocks) are not the user's and read as "".
func userText(data json.RawMessage) string {
	var d struct {
		User struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"user"`
		Text string `json:"text"`
	}
	if json.Unmarshal(data, &d) != nil {
		return ""
	}
	var b strings.Builder
	for _, part := range d.User.Content {
		if part.Type == "text" {
			b.WriteString(part.Text)
		}
	}
	if b.Len() == 0 {
		return d.Text
	}
	return b.String()
}

func toolName(data json.RawMessage) string {
	var d struct {
		Name     string `json:"name"`
		ToolName string `json:"tool_name"`
		Tool     string `json:"tool"`
	}
	if json.Unmarshal(data, &d) != nil {
		return ""
	}
	return cmp.Or(d.Name, d.ToolName, d.Tool)
}

// newID is a random UUID (version 4) for a submission.
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
