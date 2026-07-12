# Obsidian Reconstructed

This workbench is a desktop agent workbench built on a clean-room
reconstruction of Obsidian's frontend architecture. What began as a study of
how Obsidian's bundled app is structured has grown into a working Electron
application: a real vault, workspace and plugin runtime carrying a chat/agent
view, a GitHub workspace, an embedded terminal and a web viewer.

It runs, and it is exercised. The full test suite has 1576+ passing tests, and
the perf harness opens files in a 20,000-file vault at a 32ms median.

## What this is

- A three-runtime pnpm monorepo: a **web app** (the product), an **Electron
  desktop** shell, and a **server** runtime, each with its own dependency lane.
- A faithful reconstruction of Obsidian's core systems — Vault, Workspace,
  MetadataCache, the plugin lifecycle, themes and CSS-variable theming — and
  the dual-track plugin architecture: internal builtins use internal APIs; a
  separate public facade serves community plugins.
- Grown past study into a real product surface: builtin "core plugins" for an
  agent chat view, a GitHub workspace, a terminal, and graph/canvas/git/web
  viewer panels, all registered like internal plugins.

## Quick start

```bash
pnpm install       # pnpm only — a preinstall hook enforces it

pnpm dev           # web renderer via Vite at http://127.0.0.1:5173 (in-memory vault)
pnpm desktop       # build + launch the Electron app against a real vault on disk
pnpm build         # production build of the web app
pnpm test          # full vitest suite (1576+ tests)
```

Other entry points:

- `pnpm e2e` — Playwright end-to-end tests.
- `pnpm e2e:desktop` — Playwright against the packaged Electron shell.
- `pnpm check` — lint, typecheck (web + desktop), tests, and all builds.

## Repo map

```text
src/apps/web              the product: vault, workspace, metadata, plugin system, builtin views
src/apps/desktop          Electron main + preload — a thin native shell (@app/desktop)
src/apps/server           server runtime (@app/server)
src/apps/web/src/builtin  core plugins: agent, github, terminal, graph, canvas, git, webviewer, theme-market
docs/architecture.md      the real map — annotated tree, direction table, runtime topology, tradeoffs
docs/architecture/        Spec-Driven Development records for structural work
e2e/                      Playwright specs, including the large-vault perf harness
```

`docs/architecture.md` is the authoritative structural reference; start there
for the full module map.

## Development

- **Spec-Driven Development.** Substantial changes get a durable contract under
  `docs/` (`features/`, `issues/`, `architecture/`), authored and mechanically
  verified with docwright. See `AGENTS.md` for the workflow.
- **Perf harness.** Run the large-vault benchmark with
  `PERF_VAULT=1 pnpm exec playwright test e2e/perf/large-vault.spec.ts`.
  Baseline on a 20k-file vault: 32ms openFile median, 82ms explorer-click median.
- **End-to-end.** `pnpm e2e` (web), `pnpm e2e:desktop` (Electron), `pnpm e2e:cli`.

## Provenance

This workbench was reconstructed from a behavioral study of Obsidian — its
bundled app shape, public API names, DOM classes, and plugin extension points
(the `decode-obsidian` reference tree). It contains no original Obsidian source
code and is not affiliated with, endorsed by, or a product of Obsidian.
