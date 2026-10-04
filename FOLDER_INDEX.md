# attention/

The root owns monorepo orchestration and shared quality configuration.
Application code lives under `apps/`, contracts under `packages/`, and tests
under `tests/`. See [PROJECT_INDEX.md](PROJECT_INDEX.md) for the current map.

| Files | Purpose |
|---|---|
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Workspace packages, scripts and dependency resolution |
| `mise.toml` | Pinned toolchain and development, build and verification tasks |
| `tsconfig.json`, `tsconfig.tools.json` | Renderer/test and tools typecheck lanes |
| `vitest.config.ts` | Web and desktop test projects |
| `oxlint.json`, `.oxfmtrc.json`, `.prettierignore` | Lint and format configuration |
| `commitlint.config.js` | Conventional-commit validation |
| `.gitignore`, `.git-blame-ignore-revs` | Generated-file exclusions and relocation history |
| `AGENTS.md`, `CLAUDE.md` | Architecture and collaboration rules |
| `README.md` | Product overview and quick start |
| `PROJECT_INDEX.md`, `FOLDER_INDEX.md` | Project and root configuration indexes |

Update this index when root files change, and PROJECT_INDEX.md when the
project structure changes.
