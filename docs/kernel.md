# Attention

A pure, headless **agent kernel** in Go — derived from `pi`'s core, before any
transport/server was layered on. It drives a single agent (LLM + tools +
sessions) and nothing else. No HTTP server, no worker/two-plane, no plugin host.

The unified agent-driver abstraction (plug in pi-native / Claude Code / Codex)
and the transport layer (REST+SSE, multi-tenant cloud) are **separate layers
built on top of this kernel** — they do not live here.

## What's in here

- `internal/**` — the kernel: `agentloop`, `ai` (providers), `session`, `tool`
  (+ `builtin`), `provider`, `mode` (print / rpc), `harness`, `orchestrator`,
  `extension` (+ `jshost`), `hook`, `execenv`, `config`, `auth`, `render`,
  `resource`, `exporthtml`, `message`, `obs`.
- `cmd/along` — headless CLI (print / rpc stdio modes).

## Provenance

Extracted from the `along` Go codebase at commit `a4702cc` — the last commit
**before** `along` added its two-plane REST+SSE control-plane (the `backend` /
`protocol` / `server` / `worker` packages, June 12 2026). That is the cleanest
"TUI-less pi" point in `along`'s history: the agent core was complete, the
transport had not yet been bolted on. Layout merged into a single `internal/`
tree (upstream had it split across `src/core/` + `internal/`); module path
rewritten to `github.com/cunninghamcard-bit/Attention`.

## Build & run

```sh
go build ./...
go build -o along ./cmd/along
go test ./...
```

## Plugins

Install a plugin from a git URL or local plugin directory:

```sh
along plugin install https://github.com/you/plugin.git
```

The installer copies or clones the plugin into `~/.along/plugins/<name>` and
adds the plugin name to global settings:

```json
{
  "plugins": ["plugin-name"]
}
```

Project plugins at `.along/plugins/<name>` override global plugins at
`~/.along/plugins/<name>`.

Plugins can provide prompt-template slash commands as `commands/*.md`. They can
also register executable handler commands with `commands/commands.json`:

```json
{
  "commands": [
    {
      "name": "rtk",
      "description": "Configure RTK",
      "argumentHint": "[show]",
      "handler": {
        "type": "command",
        "command": "node",
        "args": ["${ATTENTION_PLUGIN_ROOT}/dist/rtk-command.mjs"],
        "timeout": 8
      }
    }
  ]
}
```

Handler stdin is JSON with `command_name`, `args`, `session_id`, and `cwd`.
Handler stdout must be JSON; `notifications` are returned through
`dispatch_command`. The handler environment includes `ATTENTION_PLUGIN_ROOT`,
`ATTENTION_PROJECT_DIR`, `ATTENTION_AGENT_DIR`, and the plugin `bin/` directory
on `PATH`.

Known test failures (all pre-existing at `a4702cc`, none are code regressions):

- `internal/execenv/local` and `internal/resource` — macOS-only env quirks
  (symlinked `/var`, case-insensitive FS).
- (removed 07-21: a bullet here described `internal/extension/jshost` JS
  tests needing `bun` — that package does not exist in this kernel and no
  Go source invokes bun; the extension host is native Go. Documentation
  drift from the pre-extraction snapshot.)
