---
name: review-round
description: Batch-end quality loop for attention's native/ Go code, adapted from CMGS/asl's /review-round — a hygiene ledger of what is due, style walkthrough against /code, adversarial multi-agent correctness review, /simplify lenses, comment tightening, a net-zero prod-LOC budget, the gate list, and convergence without manufactured churn. Invoke at the end of a branch or batch, or for a whole-module audit; never per commit.
---

# Review Round — batch-end convergence loop

Runs once at the end of a batch, before the user pushes. Commits inside the
batch are gated by /code's gates only.

## 0. Scope and the hygiene ledger

- Batch end: review the accumulated diff (`git diff <base>..HEAD` plus the
  working tree). Whole-module audit: every Go file in the module is in
  scope, but the ledger decides what is read.
- The ledger is `ledger.py`, beside this file. It keys each file's verdict
  by git blob per lens, so an unchanged file keeps its verdict; its header
  pins the hash of the `asl` binary, so other rules invalidate every row. By
  default it lives in the repository's git directory
  (`$(git rev-parse --git-common-dir)/hygiene/<repo>.tsv`): shared by every
  worktree, never committed.
- Open the round with
  `python3 -I .claude/skills/review-round/ledger.py diff native --lens style`
  (and `--lens judge`): the output is the reader file list. Files not due
  are not read.
- Close it with `ledger.py mark native --lens <lens> --verdict CLEAN|KEPT
  [--note "<kept items and why>"] <files>` for every file a reader cleared
  or the adjudicator kept. A round whose ledger is not marked is not closed;
  the report names the due count before and after.
- Docs that describe code (`native/AGENTS.md`, `native/examples/README.md`,
  `docs/cli-deviations.md`, the RFC's §5.14) are read in full every round:
  they go stale when the code moves.

## 1. Style walkthrough — readers read, the session adjudicates

Reload /code here, even if loaded earlier: a compacted context keeps an
impression of the rules, not the rules. Reader agents (Agent tool, or grok
in a worktree of its own) read every due file in full — never grep or sed
samples — against the enumerated Style Self-Check and return a per-file
ledger with line numbers. The session model plans the batches, adjudicates
every finding against the source, and walks the final diff of every touched
file through the Self-Check itself; that last pass is never delegated.
Trap to check by hand: a type immediately followed by its complete method
set, with no producer of another type wedged in.

## 2. Correctness review — adversarial, multi-agent

- Two or three independent reviewers over the diff, each with one lens:
  correctness and edge cases; the main thread and concurrency (RFC §5.8:
  UI state only on the main thread, `shellapi.Update` from goroutines,
  rutis callbacks); contracts across processes (rutis services, wire names,
  events, `plugins.json`). Full reads, a ledger of
  `file:line — lens — claim — failure scenario`.
- Verify each finding before accepting it: the reviewer must show a failure
  scenario reachable from a real call site, not a pattern. Plausible but
  wrong claims die here.
- A real bug is fixed in the round, in its own `fix` commit, with a
  regression test.
- An agent that reports and then idles gets one SendMessage asking for its
  final verdict.

## 3. /simplify lenses

Run the four lenses (reuse, simplification, efficiency, altitude). Every
finding is applied or skipped with a recorded reason, one line each in the
report: `file:line — lens — finding — applied <sha> | skipped: <reason>`.

## 4. Comment tightening

/code's Comment Style applies as written. Fix, refactor, style and perf
commits add no comment lines; count and report both numbers:
`git diff -U0 <base>..HEAD -- '*.go' | grep -cE '^\+[[:space:]]*//'` against
the same count for `^-`.

## 5. Prod-LOC budget — quality rounds shrink, not grow

A review round defaults to net-zero or net-negative production lines.
Measure with `git diff --numstat <base>..HEAD`, split prod (non-`_test.go`)
and test, and put both nets in the report. Tests are exempt. Every
net-positive prod addition the round makes (a mechanism, a helper, a
defensive branch) is justified item by item; otherwise it is churn.

## 6. Gates

From `native/`, real output pasted into the report:

```sh
gofmt -l .
go vet ./...
go test ./...
GOWORK=off asl -forwarder=false ./...
GOOS=darwin GOWORK=off asl -forwarder=false ./...
```

Plus `scripts/e2e-cli-native.mjs` (headless, real two-process wire) when
CLI or plugin wiring changed. Window checks only with `ATTENTION_HIDDEN=1`
and throwaway config, socket and data folders.

## 7. Convergence

A round with zero newly applied findings and all gates green is closed:
stop. When `ledger.py diff` lists nothing for either lens and asl is clean,
the round is closed before any reader is spawned; report that. "No change
needed", backed by the audit, is a valid outcome; churn to look productive
is not.

## 8. Report

What ran (agents, lenses, gates with real output), findings applied,
findings skipped with reasons, the round's net prod and test lines (with the
justification of any prod increase), the ledger's due counts, and the
verdict. A step that did not run is reported as skipped.
