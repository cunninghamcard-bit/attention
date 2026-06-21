# Attention

A standalone, local-first Go engine for an AI coding/chat agent — the headless
core (no TUI), corresponding to a TUI-less `pi`. Extracted from the `along` Go
codebase: the `cmd/along` headless CLI plus its `src/core` dependency closure,
with the server-form bindings (Postgres / Redis / object store) removed.

## What's in here

- `cmd/along` — headless CLI entry (print / json / rpc modes).
- `internal/**` — the engine: agent loop, AI providers, sessions, tools,
  pipeline, hooks, the local event store + control-plane HTTP (REST+SSE).

Excluded on purpose (server form): `backend/pg`, `backend/redis`, `store/pg`,
`envhost`. The local bindings (`backend/local`) are kept, so it runs fully
self-contained on one machine.

## Extending the engine

This is a **headless engine**. UI lives in a separate app; the engine itself
loads **no in-process plugin code**. Extension is declarative + out-of-process,
the way coding agents (Crush / Claude Code / Antigravity) do it:

- **Hooks** — `hooks.json` declares shell commands that fire on lifecycle
  events and return a JSON `{decision}` on stdout. `PreToolUse` (block / rewrite
  a tool call) and `PostToolUse` (rewrite output / stop the batch) are live;
  `UserPromptSubmit` / `Stop` / `SubagentStop` are accepted but inert until their
  emit sites land. Point the CLI at one with `--hooks` (defaults to
  `<agentDir>/hooks.json`). Implementation: `internal/hook/shellhooks.go`.
- **Skills** — markdown capability packs.
- **Tools** — built-in tools are compiled Go (`internal/tool/builtin`); external
  tools belong behind MCP (planned), not an in-engine code host.

Example `hooks.json`:

```json
[
  { "event": "PreToolUse", "toolName": "bash", "command": "./hooks/guard.sh", "timeoutMs": 5000 }
]
```
`guard.sh` reads the event JSON on stdin and prints e.g.
`{"decision":"block","reason":"destructive command"}` to deny the call.

## Build & run

```sh
go build ./...          # build everything
go build -o along ./cmd/along
go test ./...           # tests (two pre-existing macOS-only env failures)
```

## Provenance

Lifted from `along` (a Go rewrite of `pi`'s core) at its current HEAD. The core
engine has no import edges into the server-form packages, so the slice is clean:
only the module path and bundled plugins differ from upstream.
