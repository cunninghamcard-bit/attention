## Architecture: reconstruct Obsidian, do not invent a parallel system

This project is a faithful reconstruction of Obsidian. Its cross-cutting
systems — the CSS/cascade system, the layout and typography system, the
notice/error system, the settings surface, the icon system, and every other
protocol — must **reproduce Obsidian's**, not stand up a second independent
one beside it. This is the single most important rule in the repo.

**Read the source; do not write your own.** Obsidian's shipped code is ground
truth, and it is checked in:

- `decode-obsidian/ref/obsidian/app.css` — CSS, layout, typography, the
  cascade. A class name or rule there IS the spec; match it byte-for-byte.
- `decode-obsidian/ref/obsidian/app.js` — DOM structure, component behavior,
  the protocols (notices, modals, settings, events, icons).

Before writing a rule or a component, find how Obsidian does it and port
_that_. Guessing, or writing "something that looks right," is the exact
anti-pattern this project exists to avoid — verify against app.css/app.js,
never against memory or intuition.

**Reuse the small components; never fork a second protocol.** There is one
`TreeItem`, one `Setting` / `SettingGroup`, one `Notice`, one `Modal`, one
icon registry, one token layer. A new view _composes_ these; it does not
hand-roll its own row / button / notice / dropdown. Reinventing a primitive,
or standing up an "our own" CSS / notice / settings system next to the
faithful one, breaks the architecture and is not allowed. If a primitive is
missing a capability, extend the shared primitive — do not clone it.

**The stylesheet layering is the boundary, and it is load-bearing.**
Everything under `styles/{tokens,base,components,features,workspace,editor}`
is a _faithful extract_ of app.css and must stay byte-identical to it. Our
own CSS lives WITH its component (`ui/`, `builtin/<slice>/`, `views/`,
`app/`), imported by `styles/index.css` after every faithful layer, and
behaves like a well-mannered community plugin: selectors stay in the
component's own namespace — faithful classes appear only as ancestor
context or under an own attribute qualifier — and faithful design tokens
are consumed or locally parameterized, never redefined globally. There is
NO override layer: deliberate deviations live one-per-file under
`styles/deviations/` with their measured rationale, and every recorded
restyle carries its verdict in the wall's allowlist
(docs/architecture/style-deviations). Never put a product choice in a
faithful file; never let a faithful file drift from app.css. (Guarded by
`StyleSystem.test.ts`: the exactly-once manifest, own-last order, and the
restyle/token walls.)

**Semantics drive structure, not behavior.** An element's classes are decided
by _what it is_ — a file wears `nav-file` / `nav-file-title`, a folder or
container wears `nav-folder` — never by _what it can do_ (collapsible is not
the same as folder). Get this wrong and themes render the element as the wrong
thing (a file painted as a folder), because themes key off these exact class
names.

## Toolchain: mise is the entry point, never the raw tool

`mise.toml` pins Node/pnpm/Go and owns every task; `mise tasks` lists them
with the caveats. pnpm still owns dependencies underneath, and vp (Vite+)
fronts dev/test/build. Reach for a task, not the underlying binary — the
tasks encode the asymmetries (the nested `cmd/tui` Go module needs its own
vet/lint/test invocation; the three tsc lanes stay explicit because vp
check's type stage does not engage this repo).

| Task | Use it for |
|---|---|
| `mise run setup` | New machine: pnpm + Go deps |
| `mise run dev` | Vite dev server on 127.0.0.1:5173 |
| `mise run desktop:dev` | Electron against that dev server (HMR). Needs `mise run dev` running |
| `mise run desktop:start` | Build web + Electron, launch the built app — verify a real build |
| `mise run lint` / `format` | Lint is non-mutating and warnings fail it; `format` rewrites |
| `mise run typecheck` / `test` / `test:go` | The three tsc lanes / vitest / both Go modules |
| `mise run test:e2e` / `test:e2e:desktop` | Playwright, web / Electron |
| `mise run gate` | The whole pre-handoff gate in one command |

Things that have bitten us here:

- **Ctrl+C out of a launched app is not a failure.** Ctrl+C signals the whole
  process group, so the shell dies with it and mise reports `no exit status
  → task failed`. `desktop:dev`/`desktop:start` trap INT so a normal quit
  reads as success; if you launch Electron some other way, expect the noise.
- **`test:e2e:desktop` builds nothing.** Playwright launches
  `out/desktop/main.cjs` as it finds it — run `web:build` and
  `desktop:build` first, or you are testing a stale binary.
- **The task cache is on for builds and typecheck, never for tests.** `vp run
  --cache` is content-addressed and a hit *restores the outputs* (delete
  `out/` and a hit rebuilds it from cache — verified by running the desktop
  e2e against restored artifacts). Editing a source file misses immediately;
  reverting it hits again. Tests and lint stay uncached because a replayed log
  is not a run, and this repo's handoff rule says a borrowed green is not a
  green. `mise run cache:clean` when a cached result looks wrong.
- **Never `vp check --fix`.** Its lint autofixes rewrite semantics. Use
  `mise run format`.
- **A `[tools]` pin only wins if mise's paths outrank the system on `$PATH`.**
  `mise run`/`mise exec` do load the pinned tools — the docs promise their
  entries land "before the shim directory", and they do. The catch is that
  mise positions them *relative to the shim directory*, so if that directory
  sits after `/opt/homebrew/bin` (ours is 20th, Homebrew is 6th), the shell
  finds the Homebrew `go`/`node`/`pnpm` first and the pins never apply. It
  stays invisible while versions coincide — node and pnpm match today by luck.
  Go drifted (system 1.26.4 vs pinned 1.26.5) and failed loudly, because mise
  exports `GOROOT` regardless of `$PATH`: a 1.26.4 `go` driving a 1.26.5
  GOROOT dies with `compile: version "go1.26.5" does not match go tool version
  "go1.26.4"`. Hence every Go task runs `PATH="$GOROOT/bin:$PATH" go ...`,
  which is self-consistent under any PATH order. Audit yours with
  `mise exec -- sh -c 'echo $PATH' | tr : '\n' | grep -n -E 'homebrew/bin|mise'`;
  `mise activate` is the real fix, since it prepends instead of positioning
  against the shims. Also pin every tool a task calls — an unpinned
  `golangci-lint` resolves to a shim that refuses to run.
- **Never `vp check --fix`.** Its lint autofixes rewrite semantics. Use
  `mise run format`.
- **A `[tools]` pin only wins if mise's shims outrank the system on `$PATH`.**
  Unactivated (`mise doctor` → `activated: no`), mise works through its shim
  directory, and that directory sits *after* `/opt/homebrew/bin` on a typical
  machine. So a task body — which is `sh -c`, resolving commands off `$PATH` —
  gets the Homebrew `go`/`node`/`pnpm`, not the pinned one; only tools Homebrew
  lacks (golangci-lint) fall through to a shim. It stays invisible while the
  versions coincide, which is exactly our situation for node and pnpm today.
  Go is the one that drifted (system 1.26.4 vs pinned 1.26.5) and it fails
  loudly, because mise *does* export `GOROOT` regardless of `$PATH`: a 1.26.4
  `go` driving a 1.26.5 GOROOT dies with `compile: version "go1.26.5" does not
  match go tool version "go1.26.4"`. Hence every Go task runs
  `PATH="$GOROOT/bin:$PATH" go ...` — authoritative on any machine, with no
  `mise activate` and no `mise trust` (an `[env] _.path` block needs both and
  did not even take effect). Check with `mise exec -- sh -c 'go version'`.
  Activating mise in your shell fixes node/pnpm the same way for everything
  else; without it, treat those pins as documentation, not enforcement.
- **A missing patch file breaks every `pnpm run`.** `patchedDependencies` in
  `pnpm-workspace.yaml` is verified before any script runs, so a deleted
  patch fails the script with ENOENT before it starts. Keep the two in sync.

## Collaboration: sandboxed writes, committed handoffs

Multiple agents work this repo. Two rules keep them from destroying each
other's work — both were paid for with real accidents:

**Write in a sandbox, land as a commit.** No agent edits a shared worktree
directly. Do the work in your own isolated copy (a boxsh COW sandbox —
`--bind cow:<repo>:<dst>` — or a detached git worktree), then land it as a
COMPLETE commit on the branch. Uncommitted WIP must never sit in a tree
another agent can touch: every collision we have had was ignited by exactly
that. Finish → commit → hand off; never leave state behind.

**One branch, one committer.** Each branch has a single owner who lands
commits on it. Everyone else is read-only there: contribute by handing the
owner a committed hash to adopt (git show/log/diff to audit), never by
pushing your own commits into someone else's branch. Before any commit in a
shared tree, run `git branch --show-current` and make sure you are where
you think you are.

Verification runs before every handoff: the full gate green in YOUR sandbox
on YOUR hash, receipts included. A green you borrowed from another tree or
an earlier HEAD is not a green.
