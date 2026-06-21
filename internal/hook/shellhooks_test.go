package hook

// Pure-Go tests for the declarative shell-hooks runner. NO node, NO JS host.
// A temp hooks.json + a tiny shell script drive the registry and we assert the
// handler returns the EXACT concrete result types the pipeline folds
// type-assert on (ToolCallResult / ToolResultPatch).

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/cunninghamcard-bit/Attention/internal/ai"
)

// writeScript writes an executable shell script and returns a command string
// that runs it via the path. Using `sh <path>` keeps it portable.
func writeScript(t *testing.T, dir, name, body string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
		t.Fatalf("write script: %v", err)
	}
	return "sh " + p
}

func writeHooks(t *testing.T, dir, content string) string {
	t.Helper()
	p := filepath.Join(dir, "hooks.json")
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatalf("write hooks.json: %v", err)
	}
	return p
}

func loadAndRegister(t *testing.T, path string) *Registry {
	t.Helper()
	runner, err := LoadShellHooks(path)
	if err != nil {
		t.Fatalf("LoadShellHooks: %v", err)
	}
	if !runner.HasHandlers() {
		t.Fatalf("runner has no handlers")
	}
	reg := NewRegistry()
	runner.Register(reg, "sess-1")
	return reg
}

func TestShellHooksPreToolUseBlock(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell hooks test requires a POSIX shell")
	}
	dir := t.TempDir()
	cmd := writeScript(t, dir, "deny.sh", `echo '{"decision":"block","reason":"nope"}'`)
	hooks := writeHooks(t, dir, `[{"event":"PreToolUse","command":"`+cmd+`"}]`)

	reg := loadAndRegister(t, hooks)

	res, err := reg.Emit(context.Background(), ToolCallEvent{
		Type:       EventToolCall,
		ToolCallId: "call-1",
		ToolName:   "Bash",
		Input:      map[string]any{"command": "rm -rf /"},
	})
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// CRITICAL: the fold does result.(hook.ToolCallResult); a pointer/map is
	// silently ignored. Prove the concrete value type.
	tc, ok := res.(ToolCallResult)
	if !ok {
		t.Fatalf("result type = %T, want hook.ToolCallResult", res)
	}
	if !tc.Block {
		t.Fatalf("Block = false, want true")
	}
	if tc.Reason != "nope" {
		t.Fatalf("Reason = %q, want nope", tc.Reason)
	}
}

func TestShellHooksAllowOnEmptyStdout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell hooks test requires a POSIX shell")
	}
	dir := t.TempDir()
	// Script prints nothing => no opinion => handler returns (nil, nil) => allow.
	cmd := writeScript(t, dir, "noop.sh", `exit 0`)
	hooks := writeHooks(t, dir, `[{"event":"PreToolUse","command":"`+cmd+`"}]`)

	reg := loadAndRegister(t, hooks)

	res, err := reg.Emit(context.Background(), ToolCallEvent{
		Type:     EventToolCall,
		ToolName: "Bash",
		Input:    map[string]any{"command": "ls"},
	})
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	if res != nil {
		t.Fatalf("result = %#v, want nil (allow/no-opinion)", res)
	}
}

func TestShellHooksAllowOnExecError(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell hooks test requires a POSIX shell")
	}
	dir := t.TempDir()
	// Non-zero exit (and stderr noise) => allow-on-error default => (nil, nil).
	cmd := writeScript(t, dir, "boom.sh", `echo oops 1>&2; exit 7`)
	hooks := writeHooks(t, dir, `[{"event":"PreToolUse","command":"`+cmd+`"}]`)

	reg := loadAndRegister(t, hooks)

	res, err := reg.Emit(context.Background(), ToolCallEvent{
		Type:     EventToolCall,
		ToolName: "Bash",
		Input:    map[string]any{"command": "ls"},
	})
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	if res != nil {
		t.Fatalf("result = %#v, want nil (allow-on-error)", res)
	}
}

func TestShellHooksToolCallInputMutation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell hooks test requires a POSIX shell")
	}
	dir := t.TempDir()
	cmd := writeScript(t, dir, "mutate.sh",
		`echo '{"decision":"allow","input":{"command":"echo safe"}}'`)
	hooks := writeHooks(t, dir, `[{"event":"PreToolUse","command":"`+cmd+`"}]`)

	reg := loadAndRegister(t, hooks)

	res, err := reg.Emit(context.Background(), ToolCallEvent{
		Type:     EventToolCall,
		ToolName: "Bash",
		Input:    map[string]any{"command": "echo unsafe"},
	})
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	tc, ok := res.(ToolCallResult)
	if !ok {
		t.Fatalf("result type = %T, want hook.ToolCallResult", res)
	}
	if tc.Block {
		t.Fatalf("Block = true, want false (allow + mutate)")
	}
	if got := tc.Input["command"]; got != "echo safe" {
		t.Fatalf("Input[command] = %v, want echo safe", got)
	}
}

func TestShellHooksToolNameGlobFilter(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell hooks test requires a POSIX shell")
	}
	dir := t.TempDir()
	cmd := writeScript(t, dir, "deny.sh", `echo '{"decision":"block","reason":"only bash"}'`)
	// Glob matches Bash* only.
	hooks := writeHooks(t, dir,
		`[{"event":"PreToolUse","toolName":"Bash*","command":"`+cmd+`"}]`)

	reg := loadAndRegister(t, hooks)

	// Non-matching tool => filtered out => allow.
	res, err := reg.Emit(context.Background(), ToolCallEvent{
		Type:     EventToolCall,
		ToolName: "Read",
		Input:    map[string]any{},
	})
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	if res != nil {
		t.Fatalf("non-matching tool result = %#v, want nil", res)
	}

	// Matching tool => block.
	res, err = reg.Emit(context.Background(), ToolCallEvent{
		Type:     EventToolCall,
		ToolName: "Bash",
		Input:    map[string]any{},
	})
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	if tc, ok := res.(ToolCallResult); !ok || !tc.Block {
		t.Fatalf("matching tool result = %#v, want blocked ToolCallResult", res)
	}
}

func TestShellHooksPostToolUsePatch(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell hooks test requires a POSIX shell")
	}
	dir := t.TempDir()
	cmd := writeScript(t, dir, "term.sh", `echo '{"decision":"block","reason":"stop"}'`)
	hooks := writeHooks(t, dir, `[{"event":"PostToolUse","command":"`+cmd+`"}]`)

	reg := loadAndRegister(t, hooks)

	res, err := reg.Emit(context.Background(), ToolResultEvent{
		Type:     EventToolResult,
		ToolName: "Bash",
		Content:  []ai.ContentBlock{{Type: ai.ContentText, Text: "out"}},
	})
	if err != nil {
		t.Fatalf("Emit: %v", err)
	}
	// CRITICAL: afterToolCallFold does result.(hook.ToolResultPatch).
	patch, ok := res.(ToolResultPatch)
	if !ok {
		t.Fatalf("result type = %T, want hook.ToolResultPatch", res)
	}
	if patch.Terminate == nil || !*patch.Terminate {
		t.Fatalf("Terminate = %v, want true", patch.Terminate)
	}
	if patch.IsError == nil || !*patch.IsError {
		t.Fatalf("IsError = %v, want true", patch.IsError)
	}
}

func TestLoadShellHooksMissingFileIsNil(t *testing.T) {
	runner, err := LoadShellHooks(filepath.Join(t.TempDir(), "absent.json"))
	if err != nil {
		t.Fatalf("LoadShellHooks(missing): %v", err)
	}
	if runner != nil {
		t.Fatalf("runner = %#v, want nil for missing file", runner)
	}
	if runner.HasHandlers() {
		t.Fatalf("nil runner reports handlers")
	}
}

func TestLoadShellHooksEmptyPathIsNil(t *testing.T) {
	runner, err := LoadShellHooks("")
	if err != nil {
		t.Fatalf("LoadShellHooks(\"\"): %v", err)
	}
	if runner != nil {
		t.Fatalf("runner = %#v, want nil for empty path", runner)
	}
}

func TestLoadShellHooksUnknownEventErrors(t *testing.T) {
	dir := t.TempDir()
	hooks := writeHooks(t, dir, `[{"event":"NopeEvent","command":"true"}]`)
	if _, err := LoadShellHooks(hooks); err == nil {
		t.Fatalf("LoadShellHooks accepted unknown event, want error")
	}
}
