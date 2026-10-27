---
name: loc-justify
description: Production-code volume audit for attention's native/ Go module, adapted from CMGS/asl's /loc-justify — measure prod LOC and its growth with exact commands, attribute it to packages, commits and buckets, then give every block an EARNED / CHALLENGED verdict with a ranked cut-list, through lens agents and adversarial verification. Report only: cuts land only on the user's explicit instruction; bugs it finds are fixed in the round. Invoke when native/ feels bloated, after a heavy batch, or on a cadence.
---

# LOC Justify — production code mass audit

Goal: every block of production code earns its lines. The output is a
ledger and a ranked cut-list backed by evidence. Cuts are applied only when
the user says so (§6). A real bug the scan finds is fixed in the round, in
its own `fix` commit, after re-reading the source proves it reachable.

Reading discipline as /review-round: lens agents read whole files, the
session model adjudicates every finding against the source and walks every
touched file through /code's Self-Check. Before scanning, run the hygiene
ledger for the `loc` lens (`ledger.py diff native --lens loc`) and carry its
KEPT rows forward (§4).

## 1. Measure — exact commands, never estimates

Count from `git ls-files`, from the module folder; old revisions go through
`git archive <rev> -- native | tar -x -C <scratchpad>/snap`, never a checkout
in the worktree.

- total: `git ls-files '*.go' | xargs wc -l | tail -1`
- prod: `git ls-files '*.go' | grep -v '_test\.go$' | xargs wc -l | tail -1`
- test: `git ls-files '*_test.go' | xargs wc -l | tail -1`
- prod comments: `git ls-files '*.go' | grep -v '_test\.go$' | xargs grep -h '^\s*//' | wc -l`
- prod blanks: `git ls-files '*.go' | grep -v '_test\.go$' | xargs grep -hc '^$' | paste -sd+ | bc`
- Effective prod = prod − blanks − comments. Report all five numbers. If
  comments are under 10% of prod, say comments are not the story.
- `examples/` modules are third-party samples: count them apart.
- Per-package table, and its delta against a base (the user's, else about a
  month back: `git rev-list -1 --before=<date> HEAD`).
- Top commits by net prod adds since the base: `git log --numstat <base>..`
  aggregated per commit, prod and test apart.

## 2. Attribute

Bucket the growth: features (ports of a TS slice, a roadmap phase) /
fixes and hardening / review-round additions / tests (exempt) / comments.
Name the top commits per bucket. The healthy shape: features drive the
total, review rounds net negative. Review rounds net positive is the
finding.

## 3. Justify scan — lens agents, prod code only

One lens per agent; each returns
`file:line — lens — finding — evidence (call sites, commands run)`:

- **dead / vestigial**: exported symbols with no caller, seams nothing
  injects, settings nothing reads, error branches no caller reaches. In-
  process registries (`slotsapi`, `tabtypesapi`, `actionsapi`, …) and rutis
  service methods are called across plugins and processes: grep the whole
  module, `native/examples`, and wire names (lowerCamel) before calling one
  dead. Test-only is not dead.
- **duplication**: the same logic in two plugins (a debugf per package is
  the known, accepted shape; settle it once in the ledger).
- **hand-rolled stdlib**: what /code's Modern Go table replaces.
- **unreachable defense**: guards whose failure cannot happen given the real
  callers; the agent enumerates the call sites.
- **over-design**: mechanisms (retries, extra locks, heal loops, fallbacks)
  whose justifying scenario was imagined, not observed. Ask: was there a
  real incident or a test of a real sequence? Would retry or the next build
  converge without it? Is the failure loud and its residue bounded? An
  imagined scenario with no incident is CHALLENGED by default.
- **port fidelity**: code that invents behavior where a TS source exists to
  port (`native/AGENTS.md`: port, don't rewrite) — extra lines with no TS
  counterpart and no recorded deviation.

Every candidate then gets adversarial verification: prove the cut preserves
behavior and the lines are unearned, against real call sites and tests. If
the defensive code is what makes convergence work, it is EARNED.

## 4. Ledger and verdicts

Per package: prod lines, delta since base, verdict —

- **EARNED**: one line on what the mass buys.
- **CHALLENGED**: cut-list entries, `file:symbol`, estimated −lines, why the
  cut preserves behavior, the evidence.

Rank the cut-list by lines saved. "All EARNED", backed by the scan, is a
valid outcome; never manufacture cuts, never cut tests or load-bearing WHY
comments to move the number. Mark every file read in the ledger
(`--lens loc`, CLEAN or KEPT with the kept items in the note); a rejected
candidate is not raised again until its file or a caller changes.

## 5. Report

What ran, the real outputs of §1 verbatim, skipped steps as skipped, and the
net prod and test delta of the range audited and of the round's own commits.

## 6. Apply — only on the user's explicit instruction

- Behavior is proven by the existing tests and the gates (/review-round
  §6), never by changing a test to fit the cut.
- Cuts add no comments.
- `git status` before `git add -A`.
- A cut in a per-frame `View` path or a hot CLI path gets an A/B measure
  with both arms in one run, order swapped.
