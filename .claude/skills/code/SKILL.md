---
name: code
description: Go code standard for attention's native/ module, adapted from CMGS/asl's /code — declaration layout (asl-gated), test-file layout, signature naming, comment budget, modern Go, imports, context and error handling, naming, gates. Apply when writing, reviewing or refactoring Go under native/ (not the TS app, which follows the root CLAUDE.md).
---

# Go code standard (native/)

Adapted from CMGS/asl's `code` skill for this repository. Where this file and
`native/AGENTS.md` disagree, AGENTS.md wins for architecture (plugins, slots,
the port-don't-rewrite rule); this file wins for layout and style.

## Style Self-Check (mandatory)

After writing or editing a Go file, re-read the final file top to bottom
against this list and fix every violation before committing. The list applies
to every file the change touches: a file that already violates it is fixed in
the same change. Pure moves and file splits are not exempt.

1. **Declaration layout** — imports, then one `const` block, then one data
   `var` block, then types and funcs. Never a `const`/`var` below the first
   `func`. A single declaration uses the bare form (gofmt keeps parens, but
   one entry needs none). A compile-time interface check
   (`var _ I = (*T)(nil)`) stands alone immediately above its type. A type is
   immediately followed by its complete method set. In `_test.go`, every
   test func comes before every helper. `asl` gates all of this.
2. **Comments** — see Comment Style. Godoc on exported identifiers; one-line
   WHY comments; one-line provenance for ported code (`port of
   apps/web/builtin/BacklinksView.ts`). A fix, refactor, style or perf
   commit adds no comment lines (the commit gate counts them); the reason
   goes in the commit message.
3. **Logging** — no logging library. Diagnostics go through a package's
   `debugf`, gated by `ATTENTION_DEBUG`, to stderr. Errors are returned to
   the caller, wrapped with `%w`; a goroutine that cannot return one reports
   it where the user sees it (a banner, the CLI's output), never silently.
4. **Imports** — three groups: stdlib / external (rutis, mygo, uix, …) /
   attention (`attention-ui` and `attention/native`).
5. **Context** — no `context.TODO()`; propagate the caller's `ctx`; a
   plugin's long-lived work takes the plugin's context (cancelled in its
   `Effect`).
6. **Language** — identifiers, comments, strings and code-facing docs
   (`AGENTS.md`, `native/examples/README.md`, `docs/cli-deviations.md`) are
   English. Design docs written for the user (`docs/rfc/`,
   `docs/roadmap.md`) are in the user's language, Chinese.
7. **Modern Go** — what the toolchain in `native/go.mod` provides is used,
   not hand-rolled: `slices`/`maps` helpers, `min`/`max`/`clear`,
   `for range n`, `cmp.Or` (gated by asl's `cmpor`), iterators, `wg.Go`.
8. **Signatures** — type-parameter constraints are named types; a func type
   spelled out twice gets a named type (gated by `functypedup`); a signature
   that needs three lines to read needs named types, not wrapping.
9. **Main thread** — UI state is read and written on the main thread only;
   work off it comes back through `shellapi.Update` / `shellapi.OnMain`
   (RFC §5.8). State the per-frame cost of anything added to a `View`.

## Commit Rules

- Conventional commits with a lowercase subject (commitlint:
  `@commitlint/config-conventional`): `feat`, `fix`, `refactor`, `style`,
  `perf`, `docs`, `test`, `chore`, … with a scope (`feat(web): …`).
- No trailers: no `Co-Authored-By`, no tool or AI attribution, in commits,
  PR bodies or issues. The author is the user.
- Layout-only normalization (moving declarations as asl asks) is its own
  `style(<scope>):` commit, never mixed with behavior changes; the message
  names the rule.
- A bug found during a style or audit pass is fixed in that pass, in its own
  `fix` commit, with a regression test (`native/` writes tests only for bugs
  actually hit). Re-read the source and prove the failure is reachable from a
  real call site first.

## Git Workflow

- Rebase, never merge; linear history.
- Never rewrite pushed history without the user's explicit go-ahead.
- One branch, one committer (root CLAUDE.md): work in your own worktree and
  land complete commits.

## Gates (before every commit in native/)

From `native/`:

```sh
gofmt -l .                          # prints nothing
go vet ./...
go test ./...
GOWORK=off asl -forwarder=false ./...   # zero findings
```

`asl` is the layout checker from CMGS/asl, installed with `go install` (it
lands in `$(go env GOBIN)` or `$(go env GOPATH)/bin`). The project hook
`.claude/hooks/asl-gate.sh` runs it on every module a `git commit` touches
and blocks the commit on findings; it also blocks a fix/refactor/style/perf
commit whose staged diff adds comment lines. `asl -forwarder ./...` is
advisory: a review round settles each finding once (inline it, or mark it
KEPT in the hygiene ledger, see /review-round).

For UI changes, also run the headless CLI e2e
(`scripts/e2e-cli-native.mjs`) and, when a window is needed, a run with
`ATTENTION_HIDDEN=1` and throwaway `ATTENTION_CONFIG_DIR`,
`ATTENTION_SOCKET` and `XDG_DATA_HOME`.

## File Organization

- Exported declarations above unexported ones, within each group.
- Type blocks are atomic: a type, its constructor(s), its exported methods,
  its unexported methods — nothing in between.
- A method returning another type declared in the file (a producer) trails
  that type's block.
- Method-less vocabulary types (options, payloads, enums) cluster above the
  first method-bearing type they serve.
- Standalone helpers below the method sets they serve; exported before
  unexported.
- One responsibility per file, named by what it holds (`suggest.go`,
  `cli.go`, `session.go`).

## Signatures

- Constraints are named: `type typed interface{ Type() string }` then
  `func f[T typed](…)`.
- A func type used twice is named: `type RunFunc func(ctx context.Context,
  params map[string]string, cwd string) (string, error)`.

## Error Handling

- Wrap with `fmt.Errorf("verb noun: %w", err)`, lowercase, no trailing
  punctuation. Exception: messages the CLI prints to the user port the TS
  CLI's exact wording and case (`Error: File "x" not found.`); see
  `docs/cli-deviations.md`.
- Check with `errors.Is`/`errors.As`, never by string.
- Join close errors in defers: `defer func() { err = errors.Join(err,
  f.Close()) }()`.

## Comment Style

Default to fewer comments: names and structure carry intent. The allowance:

- **Godoc** on exported identifiers, starting with the identifier's name.
  Package docs say what the package is and which TS source it ports.
- **One-line WHY**: a hidden constraint, an external quirk (mygo, rutis,
  WebKitGTK), the reason a non-obvious approach was needed.
- **Provenance**: the TS function or file a block ports, in one line.
- `//nolint:<linter>` on the line, with a reason when not obvious.

Register: short present-tense sentences, one fact each, no narrative.
Violations: restating code, section labels, edit narration ("now also…"),
the same fact at godoc and call site, inline comments in `_test.go`, a
comment enumerating an enum's values. Deletion test: a comment whose removal
costs a competent reader nothing goes, in every file you touch.

## Runtime Discipline

- `init()` only for `pluginreg.Add` in a plugin module compiled in with
  `attention build`; everywhere else wire explicitly in `Apply`.
- `panic` only for a wiring mistake at registration (a duplicate tab type,
  panel or command ID), never on input or I/O.
- Bounded fan-out with `errgroup` + `SetLimit`; no hand-rolled semaphores.
- Prefer Go libraries over subprocesses; an unavoidable `exec.Command`
  gets a one-line WHY.

## Go Modern Features

Replace on sight:

| Hand-rolled | Modern |
|---|---|
| loop + `if` + `return true` over a slice | `slices.ContainsFunc` / `IndexFunc` |
| `sort.Slice` | `slices.SortFunc` + `cmp.Compare` |
| loop collecting map keys | `slices.Collect(maps.Keys(m))` / `slices.Sorted(maps.Keys(m))` |
| `if a > b { m = a }` | `min` / `max` |
| counter-only `for i := 0; i < n; i++` | `for range n` |
| first-non-zero fallback | `cmp.Or(x, y, …)` |
| map reset loop | `clear(m)` |
| `interface{}` | `any` |
| `wg.Add(1)` + `go` + `defer wg.Done()` | `wg.Go(func() { … })` |
| `append(append([]T{}, a...), b...)` | `slices.Concat(a, b)` |

Modern means less code, not different code: a clear loop that ties with the
helper on length and clarity passes.

## Test Patterns

- Tests only for bugs actually hit (regression tests); none for new
  features.
- Table-driven where several cases share a shape; `t.TempDir()`,
  `t.Context()`; `b.Loop()` in benchmarks; `testing/synctest` instead of
  sleeps for timing.
- UI behavior: the in-process `ui.NewTester`, never synthetic keystrokes on
  the user's desktop.
