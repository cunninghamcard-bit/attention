---
name: docwright-tool-first
description: |
  CRITICAL: Use for docwright CLI tool workflow. Triggers on:
  docwright, contract, lifecycle, guard, verify, explain, stamp, checkpoint,
  spec verification, task contract, spec quality, lint spec, run log,
  "how to verify", "how to use docwright", "spec failed", "guard failed",
  contract review, contract acceptance, PR review, code review workflow,
  合约, 验证, 生命周期, 守卫, 规格检查, 质量门禁, 合约审查,
  "验证失败", "怎么用 docwright", "spec 不通过", "工作流"
---

# Agent Spec Tool-First Workflow

> **Version:** 3.3.0 | **Last Updated:** 2026-06-08 | **Tracks docwright:** 0.3.0 (BDD-spine)

You are an expert at using `docwright` as a CLI tool for contract-driven AI coding. Help users by:
- **Planning**: Render task contracts before coding with `contract`
- **Implementing**: Follow contract Intent, Decisions, Boundaries
- **Verifying**: Run `lifecycle` / `guard` to check code against specs
- **Reviewing**: Use `explain` for human-readable summaries, `stamp` for git trailers
- **Debugging**: Interpret verification failures and fix code accordingly

## IMPORTANT: CLI Prerequisite Check

**Before running any `docwright` command, Claude MUST check:**

```bash
command -v docwright || cargo install docwright
```

If `docwright` is not installed, inform the user:
> `docwright` CLI not found. Install with: `cargo install docwright`

## Core Mental Model

**The key shift**: Review point displacement. Human attention moves from "reading code diffs" to "writing contracts".

```
Traditional:  Write Issue (10%) → Agent codes (0%) → Read diff (80%) → Approve (10%)
docwright:   Write Contract (60%) → Agent codes (0%) → Read explain (30%) → Approve (10%)
```

Humans define "what is correct" (Contract). Machines verify "is the code correct" (lifecycle). Humans do final "Contract Acceptance" — not Code Review.

## Quick Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `docwright init --kind feature|issue|architecture` | Create an SDD goal package | After `docwright-sdd` classifies substantial work |
| `docwright contract <spec>` | Render Task Contract | Before coding - read the execution plan |
| `docwright lint <files>` | Spec quality check | After writing spec, before giving to Agent |
| `docwright research <spec> --code .` | Scaffold/refresh goal research.md | Clarification markers unresolvable from code (methodology: docwright-research skill) |
| `docwright lifecycle <spec> --code .` | Full lint + verify pipeline | After edits - main quality gate |
| `docwright guard --spec-dir docs --code .` | Repo-wide check | Pre-commit / CI - all specs at once |
| `docwright explain <spec> --format markdown` | PR-ready review summary | Contract Acceptance - paste into PR |
| `docwright explain <spec> --history` | Execution history | See how many retries the Agent needed |
| `docwright stamp <spec> --dry-run` | Preview git trailers | Before committing - traceability |
| `docwright graph --spec-dir docs` | Dependency graph (DOT) | After writing specs - visualize deps & critical path |
| `docwright verify <spec> --code .` | Raw verification only | When you want verify without lint gate |
| `docwright checkpoint status` | VCS-aware status | Check uncommitted state |

**Non-Rust projects (report mode):** if the spec's frontmatter declares `test_command` + `test_report`, `verify`/`lifecycle` run that command once (the project's own test runner — vitest, jest, Maven, Gradle, pytest, ...) and judge scenarios from the JUnit XML report it writes, instead of running `cargo test`. Selectors bind to report testcase names (exact or suffix match; for vitest, use the `it` title). Zero matches, ambiguous matches, skipped testcases, and a missing report file are all `fail`. Everything else in this workflow is unchanged.

## BDD-spine Commands (0.3.0)

docwright 0.3.0 absorbs living-spec-library + scaffolding/governance under the
BDD-spine model (Discovery → Formulation → Automation). These six commands are
additive — **verdict semantics and `is_passing` are unchanged**; every new check
is a sensor (lint / report / audit), never a silent change to pass/fail.

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `docwright matrix <spec> --code .` | Render the coverage matrix: Rule × Scenario × Test × Verdict × Provenance (`--format text\|json\|markdown`) | See which Rules/Examples are proven by which tests, and whether evidence is Computational vs Inferential |
| `docwright promote <spec> --rule <id> --to <cap> --code .` | Promote a passing task Rule into `docs/capabilities/<cap>.spec.md` (living-spec library) | When a task Rule has matured and should be reused across tasks. Gate: the Rule's Examples must pass (≥1 example required); the stable `id` never changes |
| `docwright audit --spec-dir docs` | Aggregate spec-library health: counts, unproven rules, ungrouped scenarios, open questions, malformed rules (`--format text\|json`) | Periodic library health snapshot. **Observability only — never gates** |
| `docwright discover --from-codebase --code <dir> --name <n> [--out <file>]` | Reverse-engineer a draft task spec from existing test functions (one bound scenario per test + a `## Questions` seed) | Cold-start: a codebase has tests but no spec. The draft is a parseable starting point, NOT a finished contract — refine the seeded Questions |
| `docwright check-structure --code <dir> --forbid <substr> --in <glob>` | Mechanical layering guard: forbid a reference within a file glob; non-zero exit on violation | Enforce architecture invariants (e.g. `--forbid crate::services --in clients/**`) in CI |
| `docwright gen-integrations [--target agents\|cursor\|claude\|all] [--out <dir>] [--check]` | Generate per-tool integration files from one source; `--check` exits non-zero on drift | Keep agents/cursor/claude integration files in sync from a single source; use `--check` as a CI drift gate |

Notes:
- `matrix` shares `verify`'s change-set flags (`--change`, `--change-scope`, `--ai-mode`) and default semantics.
- `promote` writes to `docs/capabilities/<name>.spec.md`; the capability name is path-traversal-checked.
- `audit` and `check-structure` are mechanical and read-only (no code execution beyond scanning).

## Documentation

Refer to the local files for detailed command patterns:
- `./references/commands.md` - Complete CLI command reference with all flags

## IMPORTANT: Documentation Completeness Check

**Before answering questions, Claude MUST:**
1. Read `./references/commands.md` for exact command syntax
2. If file read fails: Inform user "references/commands.md is missing, answering from SKILL.md patterns"
3. Still answer based on SKILL.md patterns + built-in knowledge

## The Seven-Step Workflow

### Step 1: Human writes Task Contract (human attention: 60%)

Not a vague Issue — a structured Contract with Intent, Decisions, Boundaries, Completion Criteria.

For substantial goal-folder work, use the dedicated `docwright-sdd` skill to classify the goal and invoke `init --kind`. This tool-first skill remains responsible for exact CLI execution, verdict interpretation, and retry behavior.

```bash
docwright init --kind feature --name "User Registration API"
# Then author the generated spec.md; structural keywords are English-only
```

For rewrite, migration, or parity tasks, classify the goal as architecture and use the parity example as an authoring reference:

```bash
docwright init --kind architecture --name "CLI Parity Contract"
```

**Key principle**: Exception scenarios >= happy path scenarios. 1 happy + 3 error paths forces you to think through edge cases before coding begins.

### Step 2: Contract quality gate

Check Contract quality before handing to Agent. Like "code review" but for the Contract itself.

```bash
docwright parse docs/features/user-registration/spec.md
docwright lint docs/features/user-registration/spec.md --min-score 0.7
```

Catches: malformed structure, zero-scenario acceptance sections, vague verbs, unquantified constraints, non-deterministic wording, missing test selectors, sycophancy bias, uncovered constraints, uncovered decisions (decision-coverage), unbound observable behavior decisions (observable-decision-coverage), uncovered output modes (output-mode-coverage), unverified precedence/fallback chains (precedence-fallback-coverage), weak mock-only I/O error scenarios (external-io-error-strength), missing verification-strength metadata on I/O scenarios (verification-metadata-suggestion), missing error paths (error-path), universal claims with insufficient scenarios (universal-claim), boundary entry points without matching scenarios (boundary-entry-point), untested flag combinations (flag-combination-coverage), untagged platform-specific decisions (platform-decision-tag).

**Required self-checks before coding:**
- `docwright parse` must show the expected section count and a non-zero scenario count for task specs.
- If `Acceptance Criteria: 0 scenarios` appears, stop and rewrite the spec before running `contract` or `lifecycle`.
- The parser accepts Markdown-heading forms like `### Scenario:` and `### Test:` for compatibility, but authoring should still emit bare `Scenario:` and `Test:` lines by default. Structural keywords are English-only (as of 0.4.0); free text may be any language. Do not invent extra top-level sections like `## Milestones`.

**Unbound Observable Behavior review:**
- After `parse + lint`, ask which stdout, stderr, file, network, cache, and persisted-state behaviors are still unbound.
- If the task is a rewrite, migration, or parity effort, also ask whether the contract covers:
  - command x output mode
  - local x remote
  - warm cache x cold start
  - fallback / precedence order
  - partial failure vs hard failure
- If any of these surfaces are still only described in prose, switch back to authoring mode and add scenarios before coding.

Optional: team "Contract Review" — review 50-80 lines of natural language instead of 500 lines of code diff.

### Step 3: Agent reads Contract and codes

Agent consumes the structured contract:

```bash
docwright contract docs/features/user-registration/spec.md
```

Agent is triple-constrained:
- **Decisions** tell it "how to do it" (no technology shopping)
- **Boundaries** tell it "what to touch" (no unauthorized file changes)
- **Completion Criteria** tell it "when it's done" (all bound tests must pass)

### Step 4: Agent self-checks with lifecycle (automatic retry loop)

```bash
docwright lifecycle docs/features/user-registration/spec.md \
  --code . --change-scope worktree --format json --run-log-dir .docwright/runs
```

Four verification layers run in sequence:
1. **lint** — re-check Contract quality (prevent spec tampering)
2. **StructuralVerifier** — pattern match Must NOT constraints against code
3. **BoundariesVerifier** — check changed files are within Allowed Changes
4. **TestVerifier** — execute tests bound to each scenario

```
Agent retry loop (no human needed):
  Code → lifecycle → FAIL (2/5) → read failure_summary → fix → lifecycle → FAIL (4/5) → fix → lifecycle → PASS (5/5) ✓
```

Run logs record this history — "this Contract took 3 tries to pass".

#### Retry Protocol

When lifecycle fails, follow this exact sequence:

1. Run: `docwright lifecycle <spec> --code . --format json`
2. Parse JSON output, find each scenario's `verdict` and `evidence`
3. For `fail`: the bound test ran and failed — read evidence to understand why, fix code
4. For `skip`: the bound test was not found — check `Test:` selector matches a real test name
5. For `uncertain`: AI verification pending — review manually or enable AI backend
6. **Fix code based on evidence. Do NOT modify the spec file** — changing the Contract to make verification pass is sycophancy, not a fix
7. Re-run lifecycle
8. After 3 consecutive failures on the same scenario, stop and escalate to the human

**Critical rule**: The spec defines "what is correct". If the code doesn't match, fix the code. If the spec itself is wrong, switch to authoring mode and update the Contract explicitly — never silently weaken acceptance criteria.

### Step 5: Guard gate (pre-commit / CI)

```bash
# Pre-commit hook
docwright guard --spec-dir docs --code . --change-scope staged

# CI (GitHub Actions)
docwright guard --spec-dir docs --code . --change-scope worktree
```

Runs lint + verify on ALL specs against current changes. Blocks commit/PR if any spec fails.

### Step 6: Contract Acceptance replaces Code Review (human attention: 30%)

Human reviews a Contract-level summary, not a code diff:

```bash
docwright explain docs/features/user-registration/spec.md --code . --format markdown
```

Reviewer judges two questions:
1. **Is the Contract definition correct?** (Intent, Decisions, Boundaries make sense?)
2. **Did all verifications pass?** (4/4 pass including error paths?)

If both "yes" → approve. This is 10x faster than reading code diffs.

Check retry history if needed:

```bash
docwright explain docs/features/user-registration/spec.md --code . --history
```

#### Assisting Contract Acceptance

When helping a human review a completed task:

1. Run `docwright explain <spec> --code . --format markdown` and present the output
2. If human asks about retry history: run with `--history` flag
3. If human asks about specific failures: run `docwright lifecycle <spec> --code . --format json` and extract the relevant scenario results
4. If human approves: run `docwright stamp <spec> --code . --dry-run` and present the trailers

### Step 7: Stamp and archive

```bash
docwright stamp docs/features/user-registration/spec.md --dry-run
# Output: Spec-Name: 用户注册API
#         Spec-Passing: true
#         Spec-Summary: 4/4 passed, 0 failed, 0 skipped, 0 uncertain
```

Establishes Contract → Commit traceability chain.

## Verdict Interpretation

| Verdict | Meaning | Action |
|---------|---------|--------|
| `pass` | Scenario verified | No action needed |
| `fail` | Scenario failed verification | Read evidence, fix code |
| `skip` | Test not found or not run | Add missing test or fix selector |
| `uncertain` | AI stub / manual review needed | Review manually or enable AI backend |

**Key rule: `skip` != `pass`**. All four verdicts are distinct.

## VCS Awareness

docwright auto-detects the VCS from the project root. Behavior differs between git and jj:

| Condition | Behavior |
|-----------|----------|
| `.jj/` exists (even with `.git/`) | Use `--change-scope jj` instead of `worktree` |
| jj repo | Do NOT run `git add` or `git commit` — jj auto-snapshots all changes |
| jj repo | `stamp` output includes `Spec-Change:` trailer with jj change ID |
| jj repo | `explain --history` shows file-level diffs between runs (via operation IDs) |
| Only `.git/` | Use standard git commands (`--change-scope staged` or `worktree`) |
| Neither | Change scope detection unavailable; use `--change <path>` explicitly |

## Change Set Options

| Flag | Behavior | Default |
|------|----------|---------|
| `--change <path>` | Explicit file/dir for boundary checking | (none) |
| `--change-scope staged` | Git staged files | guard default |
| `--change-scope worktree` | All git working tree changes | (none) |
| `--change-scope jj` | Jujutsu VCS changes | (none) |
| `--change-scope none` | No change detection | lifecycle/verify default |

## Advanced Features

### Verification Layers

```bash
# Run only specific layers
docwright lifecycle docs/features/<goal>/spec.md --code . --layers lint,boundary,test
# Available: lint, boundary, test, ai
```

### Run Logging

```bash
docwright lifecycle docs/features/<goal>/spec.md --code . --run-log-dir .docwright/runs
docwright explain docs/features/<goal>/spec.md --history
```

### AI Mode

```bash
docwright verify docs/features/<goal>/spec.md --code . --ai-mode off      # default - no AI
docwright verify docs/features/<goal>/spec.md --code . --ai-mode stub      # testing only
docwright lifecycle docs/features/<goal>/spec.md --code . --ai-mode caller # agent-as-verifier
```

### AI Verification: Caller Mode

When `--ai-mode caller` is used, the calling Agent acts as the AI verifier. This is a two-step protocol:

**Step 1: Emit AI requests**

```bash
docwright lifecycle docs/features/<goal>/spec.md --code . --ai-mode caller --format json
```

If any scenarios are skipped (no mechanical verifier covered them), the output JSON includes:
- `"ai_pending": true`
- `"ai_requests_file": ".docwright/pending-ai-requests.json"`

The pending requests file contains `AiRequest` objects with scenario context, code paths, contract intent, and constraints.

**Step 2: Resolve with external decisions**

The Agent reads the pending requests, analyzes each scenario, then writes decisions:

```json
[
  {
    "scenario_name": "场景名称",
    "model": "claude-agent",
    "confidence": 0.92,
    "verdict": "pass",
    "reasoning": "All steps verified by code analysis"
  }
]
```

Then merges them back:

```bash
docwright resolve-ai docs/features/<goal>/spec.md --code . --decisions decisions.json
```

This produces a final merged report where Skip verdicts are replaced with the Agent's AI decisions.

**When to use caller mode:**
- When the calling Agent (Claude, Codex, etc.) can read and reason about code
- For scenarios that can't be verified by tests alone (design intent, code quality)
- When you want the Agent to be both implementor and verifier

## Best Practices

1. **Self-bootstrap**: Write specs first, lint them, then implement against them. The spec defines correctness before code exists.

2. **Bind every scenario to a test**: Every scenario needs a `Test:` selector. Without it, TestVerifier skips the scenario and reports `skip` — not `pass`.

3. **Tag critical scenarios**: Add `Tags: critical` to must-pass scenarios. Critical failures set `gate_blocked=true` and exit code 2, making them CI-friendly gates.

4. **Use the dependency graph for planning**: Add `depends` and `estimate` to spec frontmatter, then run `docwright graph --spec-dir docs` to visualize the DAG and critical path before starting work.

5. **Layered verification**: Use `--layers` to run only what you need. During early development: `--layers boundary,test`. For CI: full `lifecycle`. For quick checks: `--layers lint`.

6. **Use text for humans, JSON for agents**: `--format json` gives machine-parseable output for retry loops; the default text format is human-readable. (Note: `lifecycle`/`verify` only honor `json` and `md`/`markdown` — other values, including `compact`/`diagnostic`, render as plain text.)

7. **Aim for decision coverage**: Every Decision in the spec should be exercised by at least one scenario. The `decision-coverage` linter catches orphaned decisions.

8. **Define precise boundaries**: Use path globs (`crates/foo/**`) for mechanical enforcement. Natural language prohibitions are lint-checked but not file-path enforced. Use both.

9. **Use incremental resume for long specs**: `--resume` skips already-passed scenarios. `--resume=conservative` reruns all but detects regressions. Saves time on specs with 10+ scenarios.

10. **Split roadmaps into small specs**: Each spec should have 3-8 scenarios. If you need more, split into multiple specs with `depends` relationships. Use `docwright graph` to visualize.

## When to Use / When NOT to Use

| Scenario | Use docwright? | Why |
|----------|----------------|-----|
| Clear feature with defined inputs/outputs | Yes | Contract can express deterministic acceptance criteria |
| Bug fix with reproducible steps | Yes | Great for "given bug X, when fixed, then Y" |
| Exploratory prototyping | No | You don't know "what is done" yet - vibe code first |
| Large architecture refactor | No | Boundaries hard to define, "better architecture" isn't testable |
| Security/compliance rules | Yes (org.spec) | Encode rules once, enforce mechanically everywhere |

### Gradual Adoption

```
Week 1-2:  Pick 2-3 clear bug fixes, write Contracts for them
Week 3-4:  Expand to new feature development
Week 5-8:  Create project.spec with team coding standards
Month 3+:  Consider org.spec for cross-project governance
```

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Guard reports N specs failing | Specs have lint or verify issues | Run `lifecycle` on each failing spec individually |
| `skip` verdict on scenario | Test selector doesn't match any test | Check `Test:` / `Package:` / `Filter:` in spec |
| Quality score below threshold | Too many lint warnings | Fix vague verbs, add quantifiers, improve testability |
| Boundary violation detected | Changed file outside allowed paths | Either update Boundaries or revert the change |
| `uncertain` on all AI scenarios | Using `--ai-mode stub` or no backend | Expected — review manually |
| Agent keeps failing lifecycle | Contract criteria too vague or too strict | Improve Completion Criteria specificity |

## Command Priority

| Preference | Use | Instead of |
|------------|-----|------------|
| `contract` | Render task contract | `brief` (legacy alias) |
| `lifecycle` | Full pipeline | `verify` alone (misses lint) |
| `guard` | Repo-wide | Multiple individual `lifecycle` calls |
| `--change` | Explicit paths known | `--change-scope` when paths are known |
| CLI commands | Tool-first approach | `spec-gateway` library API |

## When to Switch to Authoring Mode

During implementation, if you discover:
- A missing exception path that should be in Completion Criteria
- A Boundary that's too restrictive (need to modify more files than allowed)
- A Decision that needs to change (technology choice was wrong)

Switch to `docwright-authoring` skill, update the Contract FIRST, re-run `docwright lint` to validate the change, then resume implementation. Do NOT silently work outside the Contract's boundaries.

## Escalation

Switch to library integration only when:
- Embedding `docwright` into another Rust agent runtime
- Testing `spec-gateway` internals
- Injecting a host `AiBackend` via `verify_with_backend(Arc<dyn AiBackend>)`
