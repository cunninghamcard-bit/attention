package hook

// shellhooks.go is a declarative shell-hooks runner in the Claude Code /
// Antigravity style: a hooks.json file maps a lifecycle event to a shell
// command; the command receives the hook Event as JSON on stdin and may print a
// JSON {decision} on stdout to allow/block/mutate.
//
// It lives in package hook (not a separate package) for two reasons:
//   - it must return the EXACT concrete result types the pipeline folds
//     type-assert on (ToolCallResult for tool_call, ToolResultPatch for
//     tool_result); a pointer or map is silently ignored by the fold's strict
//     type assertion (internal/pipeline/mw_hooks.go), the single most likely
//     silent-failure bug.
//   - it reuses the Event* constants without an import cycle.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/cunninghamcard-bit/Attention/internal/ai"
)

// defaultShellHookTimeout bounds a single hook command invocation when the
// hooks.json entry omits timeoutMs.
const defaultShellHookTimeout = 30 * time.Second

// shellHookEntry is one rule from hooks.json.
//
//	[
//	  {"event": "PreToolUse",  "toolName": "Bash", "command": "./deny-rm.sh", "timeoutMs": 5000},
//	  {"event": "PostToolUse", "command": "./scrub-secrets.sh"}
//	]
//
// event uses the ecosystem (Claude Code) name; it is translated to a native
// hook Event* constant via the ecosystem alias map. toolName, when set, is a
// filepath.Match glob filtered against the event's ToolName; empty => all tools.
type shellHookEntry struct {
	Event     string `json:"event"`
	ToolName  string `json:"toolName,omitempty"`
	Command   string `json:"command"`
	TimeoutMs int    `json:"timeoutMs,omitempty"`
}

// shellHookDecision is the JSON a hook command prints on stdout.
//
//	{"decision": "block", "reason": "rm -rf is not allowed"}
//	{"decision": "allow", "input": {"path": "/safe"}}
//
// Empty stdout, "allow", or an unrecognized/empty decision => no opinion
// (allow). "block"/"deny" => block (tool_call) or terminate (tool_result).
type shellHookDecision struct {
	Decision string          `json:"decision,omitempty"`
	Reason   string          `json:"reason,omitempty"`
	Input    map[string]any  `json:"input,omitempty"`
	Content  json.RawMessage `json:"content,omitempty"`
}

// resolvedHook is a parsed, ready-to-register rule.
type resolvedHook struct {
	nativeEvent string
	toolGlob    string
	command     string
	timeout     time.Duration
}

// ShellHooksRunner registers declarative shell-hook handlers on a Registry.
type ShellHooksRunner struct {
	hooks []resolvedHook
}

// ecosystemAliases maps Claude Code / Antigravity ecosystem event names to the
// engine's native hook Event* constants.
//
// LIVE (real emit site today): PreToolUse, PostToolUse.
// INERT (alias accepted, but no Emit call site yet, so handlers never fire):
// UserPromptSubmit, Stop, SubagentStop, SessionStart. SessionStart is mapped to
// before_agent_start so a mutate-at-boot hook fires per agent run; the
// observe-only session_start event has no emit site. These are documented as
// inert and warned about at registration so a user cannot believe a Stop hook
// is active when nothing dispatches it.
var ecosystemAliases = map[string]string{
	// Live.
	"PreToolUse":  EventToolCall,
	"PostToolUse": EventToolResult,
	"tool_call":   EventToolCall,
	"tool_result": EventToolResult,
	// Mutate-at-boot (live via MWContext when registered).
	"SessionStart":       EventBeforeAgentStart,
	"before_agent_start": EventBeforeAgentStart,
	"context":            EventContext,
	// Inert: accepted for forward-compat, but no emit site yet.
	"UserPromptSubmit": EventInput,
	"input":            EventInput,
	"Stop":             EventSettled,
	"SubagentStop":     EventAgentEnd,
	"session_start":    EventSessionStart,
}

// inertEvents are native events with no live Emit call site; a hook registered
// on one of these compiles and registers but never fires.
var inertEvents = map[string]bool{
	EventInput:        true,
	EventSettled:      true,
	EventAgentEnd:     true,
	EventSessionStart: true,
}

// LoadShellHooks reads and parses a hooks.json file. A missing file or an empty
// rule set returns (nil, nil) so the caller preserves today's no-hooks
// behavior. A malformed file returns an error.
func LoadShellHooks(path string) (*ShellHooksRunner, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("hook: read hooks file %q: %w", path, err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil, nil
	}

	var entries []shellHookEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("hook: parse hooks file %q: %w", path, err)
	}
	if len(entries) == 0 {
		return nil, nil
	}

	resolved := make([]resolvedHook, 0, len(entries))
	for i, e := range entries {
		if strings.TrimSpace(e.Command) == "" {
			return nil, fmt.Errorf("hook: hooks[%d] (%q) missing command", i, e.Event)
		}
		native, ok := ecosystemAliases[e.Event]
		if !ok {
			return nil, fmt.Errorf("hook: hooks[%d] unknown event %q", i, e.Event)
		}
		timeout := defaultShellHookTimeout
		if e.TimeoutMs > 0 {
			timeout = time.Duration(e.TimeoutMs) * time.Millisecond
		}
		resolved = append(resolved, resolvedHook{
			nativeEvent: native,
			toolGlob:    e.ToolName,
			command:     e.Command,
			timeout:     timeout,
		})
	}
	return &ShellHooksRunner{hooks: resolved}, nil
}

// HasHandlers reports whether any rules were loaded.
func (r *ShellHooksRunner) HasHandlers() bool {
	return r != nil && len(r.hooks) > 0
}

// Register attaches one Registry handler per loaded rule. The handler marshals
// the event to JSON, runs the command with a ctx-bounded timeout (stdin = event
// JSON), and parses stdout into the CONCRETE result type the fold expects.
func (r *ShellHooksRunner) Register(reg *Registry, sessionID string) {
	if r == nil || reg == nil {
		return
	}
	for _, h := range r.hooks {
		if inertEvents[h.nativeEvent] {
			fmt.Fprintf(os.Stderr,
				"hook: shell hook on %q registered but INERT (no emit site yet; it will never fire)\n",
				h.nativeEvent)
		}
		h := h // capture per-iteration
		reg.On(h.nativeEvent, r.makeHandler(h, sessionID))
	}
}

// makeHandler builds the Registry Handler for a single rule.
func (r *ShellHooksRunner) makeHandler(h resolvedHook, sessionID string) Handler {
	return func(ctx context.Context, event any) (any, error) {
		// Tool-name glob filter (tool_call / tool_result only).
		if h.toolGlob != "" {
			name := eventToolName(event)
			if name == "" {
				return nil, nil
			}
			if matched, _ := filepath.Match(h.toolGlob, name); !matched {
				return nil, nil
			}
		}

		decision, ran := r.runCommand(ctx, h, sessionID, event)
		if !ran {
			// Exec/parse error or no opinion => allow-on-error default.
			return nil, nil
		}

		switch h.nativeEvent {
		case EventToolCall:
			return toolCallResultFrom(decision), nil
		case EventToolResult:
			return toolResultPatchFrom(decision), nil
		default:
			// before_agent_start / context / inert events: shell hooks shape no
			// concrete mutate result here, so they are observe-only.
			return nil, nil
		}
	}
}

// runCommand marshals the event, runs the hook command with stdin = event JSON,
// and parses stdout. ran=false means allow (empty stdout, parse miss, or exec
// error — allow-on-error default).
func (r *ShellHooksRunner) runCommand(
	ctx context.Context,
	h resolvedHook,
	sessionID string,
	event any,
) (shellHookDecision, bool) {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return shellHookDecision{}, false
	}

	cctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, "sh", "-c", h.command)
	cmd.Stdin = strings.NewReader(string(eventJSON))
	cmd.Env = append(os.Environ(), "ALONG_SESSION_ID="+sessionID)

	out, err := cmd.Output()
	if err != nil {
		// Allow-on-error: a failing hook does not block the tool. (Deny-on-error
		// would be a documented config knob; not enabled here.)
		return shellHookDecision{}, false
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" || trimmed == "null" {
		return shellHookDecision{}, false
	}

	var decision shellHookDecision
	if err := json.Unmarshal([]byte(trimmed), &decision); err != nil {
		return shellHookDecision{}, false
	}
	return decision, true
}

// toolCallResultFrom builds the CONCRETE ToolCallResult the beforeToolCallFold
// type-asserts on. block/deny => Block:true; an "input" mutation threads new
// args.
func toolCallResultFrom(d shellHookDecision) ToolCallResult {
	return ToolCallResult{
		Block:  isBlock(d.Decision),
		Reason: d.Reason,
		Input:  d.Input,
	}
}

// toolResultPatchFrom builds the CONCRETE ToolResultPatch the afterToolCallFold
// type-asserts on. block/deny => Terminate:true; a "content" override rewrites
// the tool output.
func toolResultPatchFrom(d shellHookDecision) ToolResultPatch {
	patch := ToolResultPatch{}
	if isBlock(d.Decision) {
		term := true
		patch.Terminate = &term
		isErr := true
		patch.IsError = &isErr
	}
	if len(d.Content) > 0 {
		var blocks []ai.ContentBlock
		if err := json.Unmarshal(d.Content, &blocks); err == nil {
			patch.Content = blocks
		}
	}
	return patch
}

func isBlock(decision string) bool {
	switch strings.ToLower(strings.TrimSpace(decision)) {
	case "block", "deny":
		return true
	default:
		return false
	}
}

// eventToolName reads ToolName off the concrete tool_call / tool_result events
// for glob filtering. Unknown event shapes yield "".
func eventToolName(event any) string {
	switch e := event.(type) {
	case ToolCallEvent:
		return e.ToolName
	case ToolResultEvent:
		return e.ToolName
	default:
		return ""
	}
}
