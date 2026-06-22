package hook

// shellhooks.go is a declarative shell-hooks runner in the Claude Code /
// Antigravity style: a hooks.json file maps a lifecycle event to a shell
// command; the command receives the hook Event as JSON on stdin and may print a
// JSON {decision} on stdout to allow/block/mutate.
//
// It lives in package hook (not a separate package) for two reasons:
//   - it must return the EXACT concrete result types the pipeline folds and the
//     harness/orchestrator emit sites type-assert on (ToolCallResult for
//     tool_call, ToolResultPatch for tool_result, BeforeAgentStartResult for
//     before_agent_start, SessionBeforeCompactResult for session_before_compact,
//     ...); a pointer or map is silently ignored by those strict type
//     assertions, the single most likely silent-failure bug.
//   - it reuses the Event* constants without an import cycle.
//
// Every event in events.go is wired here EXCEPT queue_update: hook.QueueUpdateEvent
// is declared but never emitted through any hook.Registry (the orchestrator
// publishes its own orchestrator.Event for queue changes), so a shell hook on it
// would never fire. It is the single genuinely-inert event and is warned about
// at registration.

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
// event uses either the ecosystem (Claude Code) name or the native hook Event*
// constant; it is translated to a native constant via the alias map. toolName,
// when set, is a filepath.Match glob filtered against the event's ToolName
// (tool_call / tool_result only); empty => all tools / all events.
type shellHookEntry struct {
	Event     string `json:"event"`
	ToolName  string `json:"toolName,omitempty"`
	Command   string `json:"command"`
	TimeoutMs int    `json:"timeoutMs,omitempty"`
}

// shellHookDecision is the JSON a hook command prints on stdout. It is a unified
// envelope: a command targeting any event populates the fields meaningful for
// that event and leaves the rest empty.
//
//	{"decision": "block", "reason": "rm -rf is not allowed"}        # tool_call / tool_result
//	{"decision": "allow", "input": {"path": "/safe"}}               # tool_call
//	{"content": [...], "isError": true, "terminate": true}          # tool_result
//	{"systemPrompt": "..."}                                         # before_agent_start
//	{"messages": [...]}                                             # context
//	{"action": "transform", "text": "..."}                          # input
//	{"cancel": true}                                                # session_before_*
//	{"skillPaths": ["..."]}                                         # resources_discover
//
// Empty stdout, "null", or a parse miss => no opinion (allow / no-change).
//
// The structured payload-shaped fields (messages/payload/message/streamOptions)
// map to result types whose Go field is `any`; they are decoded generically.
type shellHookDecision struct {
	// Common control fields.
	Decision string `json:"decision,omitempty"`
	Reason   string `json:"reason,omitempty"`

	// tool_call.
	Input map[string]any `json:"input,omitempty"`

	// tool_result.
	Content   json.RawMessage `json:"content,omitempty"`
	Details   json.RawMessage `json:"details,omitempty"`
	IsError   *bool           `json:"isError,omitempty"`
	Terminate *bool           `json:"terminate,omitempty"`

	// before_agent_start.
	SystemPrompt *string `json:"systemPrompt,omitempty"`

	// before_agent_start / context: a list of messages (each `any`).
	Messages json.RawMessage `json:"messages,omitempty"`

	// input.
	Action string         `json:"action,omitempty"`
	Text   string         `json:"text,omitempty"`
	Images []ImageContent `json:"images,omitempty"`

	// before_provider_request.
	StreamOptions json.RawMessage `json:"streamOptions,omitempty"`

	// before_provider_payload.
	Payload json.RawMessage `json:"payload,omitempty"`

	// message_end.
	Message json.RawMessage `json:"message,omitempty"`

	// session_before_switch / session_before_fork / session_before_compact /
	// session_before_tree.
	Cancel                  bool `json:"cancel,omitempty"`
	SkipConversationRestore bool `json:"skipConversationRestore,omitempty"`

	// session_before_compact override.
	Compaction *CompactionResult `json:"compaction,omitempty"`

	// session_before_tree override.
	Summary             *BranchSummaryResult `json:"summary,omitempty"`
	CustomInstructions  *string              `json:"customInstructions,omitempty"`
	ReplaceInstructions *bool                `json:"replaceInstructions,omitempty"`
	Label               *string              `json:"label,omitempty"`

	// user_bash.
	Output         string `json:"output,omitempty"`
	ExitCode       *int   `json:"exitCode,omitempty"`
	Cancelled      bool   `json:"cancelled,omitempty"`
	Truncated      bool   `json:"truncated,omitempty"`
	FullOutputPath string `json:"fullOutputPath,omitempty"`

	// resources_discover.
	SkillPaths  []string `json:"skillPaths,omitempty"`
	PromptPaths []string `json:"promptPaths,omitempty"`
	ThemePaths  []string `json:"themePaths,omitempty"`
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

// decisionEvents are the events whose handler result influences behavior. The
// makeHandler dispatch returns the EXACT concrete result type each emit site
// type-asserts for these.
var decisionEvents = map[string]bool{
	EventBeforeAgentStart:      true,
	EventContext:               true,
	EventInput:                 true,
	EventBeforeProviderRequest: true,
	EventBeforeProviderPayload: true,
	EventToolCall:              true,
	EventToolResult:            true,
	EventMessageEnd:            true,
	EventSessionBeforeSwitch:   true,
	EventSessionBeforeFork:     true,
	EventSessionBeforeCompact:  true,
	EventSessionBeforeTree:     true,
	EventUserBash:              true,
	EventResourcesDiscover:     true,
}

// eventAliases maps every hooks.json "event" name to its native hook Event*
// constant. It accepts BOTH the native event name (so any kernel event can be
// targeted by its real name) AND, where one exists, the ecosystem / Claude Code
// name (PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, Stop, ...).
//
// Every native event in events.go that has a live emit site is reachable here.
// queue_update is intentionally accepted too (so a typo is not the silent cause
// of nothing happening) but warned about at registration as genuinely inert.
var eventAliases = map[string]string{
	// Ecosystem (Claude Code / Antigravity) names.
	"PreToolUse":       EventToolCall,
	"PostToolUse":      EventToolResult,
	"UserPromptSubmit": EventInput,
	"SessionStart":     EventBeforeAgentStart,
	"Stop":             EventSettled,
	"SubagentStop":     EventAgentEnd,
	"PreCompact":       EventSessionBeforeCompact,

	// Native decision events.
	EventBeforeAgentStart:      EventBeforeAgentStart,
	EventContext:               EventContext,
	EventInput:                 EventInput,
	EventBeforeProviderRequest: EventBeforeProviderRequest,
	EventBeforeProviderPayload: EventBeforeProviderPayload,
	EventToolCall:              EventToolCall,
	EventToolResult:            EventToolResult,
	EventMessageEnd:            EventMessageEnd,
	EventSessionBeforeSwitch:   EventSessionBeforeSwitch,
	EventSessionBeforeFork:     EventSessionBeforeFork,
	EventSessionBeforeCompact:  EventSessionBeforeCompact,
	EventSessionBeforeTree:     EventSessionBeforeTree,
	EventUserBash:              EventUserBash,
	EventResourcesDiscover:     EventResourcesDiscover,

	// Native notification events.
	EventAgentStart:            EventAgentStart,
	EventAgentEnd:              EventAgentEnd,
	EventTurnStart:             EventTurnStart,
	EventTurnEnd:               EventTurnEnd,
	EventMessageStart:          EventMessageStart,
	EventMessageUpdate:         EventMessageUpdate,
	EventToolExecutionStart:    EventToolExecutionStart,
	EventToolExecutionUpdate:   EventToolExecutionUpdate,
	EventToolExecutionEnd:      EventToolExecutionEnd,
	EventAfterProviderResponse: EventAfterProviderResponse,
	EventSessionStart:          EventSessionStart,
	EventSessionCompact:        EventSessionCompact,
	EventSessionTree:           EventSessionTree,
	EventSessionShutdown:       EventSessionShutdown,
	EventModelSelect:           EventModelSelect,
	EventThinkingLevelSelect:   EventThinkingLevelSelect,
	EventResourcesUpdate:       EventResourcesUpdate,
	EventQueueUpdate:           EventQueueUpdate,
	EventSavePoint:             EventSavePoint,
	EventAbort:                 EventAbort,
	EventSettled:               EventSettled,
}

// inertEvents are native events with no live Emit call site through any
// hook.Registry; a hook registered on one of these compiles and registers but
// never fires. queue_update is the only such event: hook.QueueUpdateEvent is
// declared in events.go but the orchestrator publishes its own orchestrator
// Event for queue changes rather than emitting hook.QueueUpdateEvent.
var inertEvents = map[string]bool{
	EventQueueUpdate: true,
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
		native, ok := eventAliases[e.Event]
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
// JSON), and parses stdout into the CONCRETE result type the consumer expects.
func (r *ShellHooksRunner) Register(reg *Registry, sessionID string) {
	if r == nil || reg == nil {
		return
	}
	for _, h := range r.hooks {
		if inertEvents[h.nativeEvent] {
			fmt.Fprintf(os.Stderr,
				"hook: shell hook on %q registered but INERT (no emit site through hook.Registry; it will never fire)\n",
				h.nativeEvent)
		}
		h := h // capture per-iteration
		reg.On(h.nativeEvent, r.makeHandler(h, sessionID))
	}
}

// makeHandler builds the Registry Handler for a single rule.
func (r *ShellHooksRunner) makeHandler(h resolvedHook, sessionID string) Handler {
	return func(ctx context.Context, event any) (any, error) {
		// Tool-name glob filter (tool_call / tool_result only; other events have
		// no ToolName and are unaffected).
		if h.toolGlob != "" {
			name := eventToolName(event)
			if name == "" {
				return nil, nil
			}
			if matched, _ := filepath.Match(h.toolGlob, name); !matched {
				return nil, nil
			}
		}

		// Notification events run the command for side effects and never shape a
		// result. Run unconditionally (no decision parse needed) and return
		// (nil, nil).
		if !decisionEvents[h.nativeEvent] {
			r.runCommandNotify(ctx, h, sessionID, event)
			return nil, nil
		}

		decision, ran := r.runCommand(ctx, h, sessionID, event)
		if !ran {
			// Exec/parse error or no opinion => allow / no-change default.
			return nil, nil
		}

		switch h.nativeEvent {
		case EventToolCall:
			return toolCallResultFrom(decision), nil
		case EventToolResult:
			return toolResultPatchFrom(decision), nil
		case EventBeforeAgentStart:
			return beforeAgentStartResultFrom(decision), nil
		case EventContext:
			return contextResultFrom(decision), nil
		case EventInput:
			return inputResultFrom(decision), nil
		case EventBeforeProviderRequest:
			return beforeProviderRequestResultFrom(decision), nil
		case EventBeforeProviderPayload:
			return beforeProviderPayloadResultFrom(decision), nil
		case EventMessageEnd:
			return messageEndResultFrom(decision), nil
		case EventSessionBeforeSwitch:
			return sessionBeforeSwitchResultFrom(decision), nil
		case EventSessionBeforeFork:
			return sessionBeforeForkResultFrom(decision), nil
		case EventSessionBeforeCompact:
			return sessionBeforeCompactResultFrom(decision), nil
		case EventSessionBeforeTree:
			return sessionBeforeTreeResultFrom(decision), nil
		case EventUserBash:
			return userBashResultFrom(decision), nil
		case EventResourcesDiscover:
			return resourcesDiscoverResultFrom(decision), nil
		default:
			// Should not happen: decisionEvents and this switch are kept in sync.
			return nil, nil
		}
	}
}

// runCommandNotify runs a notification-event hook command for side effects,
// discarding stdout. Errors are swallowed (a failing notify hook must not abort
// the emitting operation).
func (r *ShellHooksRunner) runCommandNotify(
	ctx context.Context,
	h resolvedHook,
	sessionID string,
	event any,
) {
	_, _ = r.exec(ctx, h, sessionID, event)
}

// runCommand marshals the event, runs the hook command with stdin = event JSON,
// and parses stdout. ran=false means allow/no-change (empty stdout, parse miss,
// or exec error — allow-on-error default).
func (r *ShellHooksRunner) runCommand(
	ctx context.Context,
	h resolvedHook,
	sessionID string,
	event any,
) (shellHookDecision, bool) {
	out, err := r.exec(ctx, h, sessionID, event)
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

// exec runs the hook command with stdin = event JSON and returns its stdout.
func (r *ShellHooksRunner) exec(
	ctx context.Context,
	h resolvedHook,
	sessionID string,
	event any,
) ([]byte, error) {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return nil, err
	}

	cctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, "sh", "-c", h.command)
	cmd.Stdin = strings.NewReader(string(eventJSON))
	cmd.Env = append(os.Environ(), "ALONG_SESSION_ID="+sessionID)
	return cmd.Output()
}

// --- Decision result converters. Each returns the EXACT concrete result type
// the corresponding emit site type-asserts. ---

// toolCallResultFrom builds the CONCRETE ToolCallResult prompt.go's
// BeforeToolCall fold type-asserts. block/deny => Block:true; an "input"
// mutation threads new args.
func toolCallResultFrom(d shellHookDecision) ToolCallResult {
	return ToolCallResult{
		Block:  isBlock(d.Decision),
		Reason: d.Reason,
		Input:  d.Input,
	}
}

// toolResultPatchFrom builds the CONCRETE ToolResultPatch prompt.go's
// AfterToolCall fold type-asserts. block/deny => Terminate+IsError; content /
// details / isError / terminate fields patch directly.
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
	if len(d.Details) > 0 {
		var details any
		if err := json.Unmarshal(d.Details, &details); err == nil {
			patch.Details = details
		}
	}
	if d.IsError != nil {
		patch.IsError = d.IsError
	}
	if d.Terminate != nil {
		patch.Terminate = d.Terminate
	}
	return patch
}

// beforeAgentStartResultFrom builds the CONCRETE BeforeAgentStartResult
// emitBeforeAgentStart type-asserts (prompt.go). systemPrompt replaces the
// running system prompt; messages are decoded generically (the harness keeps
// only those that are message.AgentMessage — raw JSON cannot satisfy that, so
// in practice systemPrompt is the load-bearing field here).
func beforeAgentStartResultFrom(d shellHookDecision) BeforeAgentStartResult {
	return BeforeAgentStartResult{
		Messages:     rawMessageSlice(d.Messages),
		SystemPrompt: d.SystemPrompt,
	}
}

// contextResultFrom builds the CONCRETE ContextResult TransformContext
// type-asserts (prompt.go). Only a non-nil Messages slice is treated as a
// change by the harness.
func contextResultFrom(d shellHookDecision) ContextResult {
	return ContextResult{
		Messages: rawMessageSlice(d.Messages),
	}
}

// inputResultFrom builds the CONCRETE InputResult emitInput type-asserts
// (orchestrator.go). Action "handled" short-circuits the turn; "transform"
// rewrites text/images.
func inputResultFrom(d shellHookDecision) InputResult {
	return InputResult{
		Action: d.Action,
		Text:   d.Text,
		Images: d.Images,
	}
}

// beforeProviderRequestResultFrom builds the CONCRETE
// BeforeProviderRequestResult emitBeforeProviderRequest type-asserts
// (prompt.go). StreamOptions is decoded generically; applyStreamOptionsPatch
// only recognizes ai.SimpleStreamOptions / hook.StreamOptionsPatch concrete
// values, so a raw decode is a no-op patch unless the consumer is extended —
// the type match itself is what this proves.
func beforeProviderRequestResultFrom(d shellHookDecision) BeforeProviderRequestResult {
	return BeforeProviderRequestResult{
		StreamOptions: rawAny(d.StreamOptions),
	}
}

// beforeProviderPayloadResultFrom builds the CONCRETE BeforeProviderPayloadResult
// emitBeforeProviderPayload type-asserts (prompt.go). Payload is the new payload.
func beforeProviderPayloadResultFrom(d shellHookDecision) BeforeProviderPayloadResult {
	return BeforeProviderPayloadResult{
		Payload: rawAny(d.Payload),
	}
}

// messageEndResultFrom builds the CONCRETE MessageEndResult
// emitMessageEndChain type-asserts (prompt.go). Message is decoded generically;
// the harness keeps it only if it is a message.AgentMessage, so a raw decode is
// inert there — the type match is what this proves.
func messageEndResultFrom(d shellHookDecision) MessageEndResult {
	return MessageEndResult{
		Message: rawAny(d.Message),
	}
}

// sessionBeforeSwitchResultFrom builds the CONCRETE SessionBeforeSwitchResult
// emitSessionBeforeSwitch type-asserts (session_runtime.go).
func sessionBeforeSwitchResultFrom(d shellHookDecision) SessionBeforeSwitchResult {
	return SessionBeforeSwitchResult{
		Cancel: d.Cancel,
	}
}

// sessionBeforeForkResultFrom builds the CONCRETE SessionBeforeForkResult
// emitSessionBeforeFork type-asserts (session_runtime.go).
func sessionBeforeForkResultFrom(d shellHookDecision) SessionBeforeForkResult {
	return SessionBeforeForkResult{
		Cancel:                  d.Cancel,
		SkipConversationRestore: d.SkipConversationRestore,
	}
}

// sessionBeforeCompactResultFrom builds the CONCRETE SessionBeforeCompactResult
// the Compact emit site type-asserts (compact.go). cancel cancels compaction; a
// "compaction" object supplies a hook-provided compaction result.
func sessionBeforeCompactResultFrom(d shellHookDecision) SessionBeforeCompactResult {
	return SessionBeforeCompactResult{
		Cancel:     d.Cancel,
		Compaction: d.Compaction,
	}
}

// sessionBeforeTreeResultFrom builds the CONCRETE SessionBeforeTreeResult the
// NavigateTree emit site type-asserts (navigate.go). cancel cancels navigation;
// summary/customInstructions/replaceInstructions/label override the branch
// summary behavior.
func sessionBeforeTreeResultFrom(d shellHookDecision) SessionBeforeTreeResult {
	return SessionBeforeTreeResult{
		Cancel:              d.Cancel,
		Summary:             d.Summary,
		CustomInstructions:  d.CustomInstructions,
		ReplaceInstructions: d.ReplaceInstructions,
		Label:               d.Label,
	}
}

// userBashResultFrom builds the CONCRETE UserBashEventResult emitUserBash
// type-asserts (bash.go). Only Result is populatable from JSON; Operations is a
// Go interface (BashOperations) that cannot come from JSON and is left nil.
func userBashResultFrom(d shellHookDecision) UserBashEventResult {
	res := UserBashEventResult{}
	if d.Output != "" || d.ExitCode != nil || d.Cancelled || d.Truncated || d.FullOutputPath != "" {
		res.Result = &BashResult{
			Output:         d.Output,
			ExitCode:       d.ExitCode,
			Cancelled:      d.Cancelled,
			Truncated:      d.Truncated,
			FullOutputPath: d.FullOutputPath,
		}
	}
	return res
}

// resourcesDiscoverResultFrom builds the CONCRETE ResourcesDiscoverResult the
// resources_discover emit site type-asserts (orchestrator.go).
func resourcesDiscoverResultFrom(d shellHookDecision) ResourcesDiscoverResult {
	return ResourcesDiscoverResult{
		SkillPaths:  d.SkillPaths,
		PromptPaths: d.PromptPaths,
		ThemePaths:  d.ThemePaths,
	}
}

// rawMessageSlice decodes a raw JSON array into a []any, one element per message.
func rawMessageSlice(raw json.RawMessage) []any {
	if len(raw) == 0 {
		return nil
	}
	var msgs []any
	if err := json.Unmarshal(raw, &msgs); err != nil {
		return nil
	}
	return msgs
}

// rawAny decodes a raw JSON value into an any.
func rawAny(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil
	}
	return v
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
