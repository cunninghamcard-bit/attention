# attention - Project Index

Attention is a web renderer and an Electron desktop shell in a pnpm monorepo.
The authoritative module map and import rules live in
[docs/architecture.md](docs/architecture.md), enforced by
[tests/architecture.test.ts](tests/architecture.test.ts).

## Directory structure

```text
attention/
├── apps/
│   ├── desktop/       Electron main, preload, native bridges and CLI socket
│   └── web/           Vault, workspace, editor, Markdown, plugins and builtin views
├── packages/
│   ├── shared/        Typed contracts shared by renderer and shell
│   └── sdk/           Reserved package seat; no implementation
├── tests/             Centralized web, desktop, e2e and architecture tests
├── scripts/           Declaration fixup and CLI e2e harness
├── docs/              Architecture, product specification and design records
├── reports/           Tracked monorepo migration mapping
├── .github/workflows/ CI using the pinned mise toolchain
└── .githooks/         Branch guard and conventional-commit validation
```

## Renderer modules

```text
apps/web/
├── api/          Public facade for community plugins
├── app/          Composition root, settings, commands and workspace lifecycle
├── builtin/      Internal feature plugins
├── core/         Shared core primitives
├── dom/          DOM helpers
├── editor/       CodeMirror integration
├── markdown/     Markdown rendering pipeline
├── metadata/     Metadata cache and indexing
├── mount/        Home and repository routing in one workspace namespace
├── platform/     Platform capabilities behind interfaces
├── plugin/       Plugin lifecycle and packaging
├── public/       Static assets
├── search/       Search services
├── storage/      Persistence adapters
├── styles/       Faithful style layers and recorded deviations
├── ui/           Shared UI primitives
├── vault/        Vault model and file operations
└── views/        Workspace view implementations
```

## Current lane sizes

Counts include all tracked files in each lane, including local documentation
and configuration. Update this table when the tracked structure changes.

| Lane | Tracked files |
|---|---:|
| `apps/web` | 461 |
| `apps/desktop` | 31 |
| `packages/shared` | 11 |
| `packages/sdk` | 1 |
| `tests` | 231 |
| `scripts` | 3 |

## Development entry points

- `mise run setup` installs dependencies with the pinned Node/pnpm versions.
- `mise run gate` runs lint, all three typecheck lanes, tests and both app builds.
- `mise run packcheck` builds and checks the public API package.
- `mise run dev` starts the web renderer; `mise run desktop:dev` starts Electron.

Root configuration is indexed in [FOLDER_INDEX.md](FOLDER_INDEX.md).
The relocation mapping in [reports/monorepo-restore/mapping.md](reports/monorepo-restore/mapping.md)
is a historical migration record, rather than the current module map.
