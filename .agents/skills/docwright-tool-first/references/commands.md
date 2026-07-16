# docwright CLI Command Reference

## All Commands — stations by workflow flow

Every subcommand has a station in one of five flows (owned by the
`docwright-sdd` skill):

```
Adoption (once per repo):
  integrate           Install governance: skills + managed policy blocks
  install-hooks       Install the pre-commit guard hook
  discover            Reverse-engineer a draft contract from existing tests
  gen-integrations    Ancestor of integrate; single-source integration files

Goal lifecycle (per goal):
  init                Create the goal folder and its contract skeleton
  research            Create or refresh the goal's research.md
  lint                Analyze contract quality
  contract            Render the Task Contract for agent execution
  plan                Generate plan context; --out births plan.md and tasks.md
  lifecycle           Full gate: lint -> verify -> report
  parse               Debugging internal: show the parsed AST
  verify              Debugging internal: verification only
  matrix              Debugging internal: coverage matrix per scenario
  guard               Repo gate: all contracts against the git change scope
  stamp               Machine-verified git trailers for the commit
  checkpoint          Preview or create a VCS checkpoint
  finish              Graduate the goal: remove consumables, keep the contract
  promote             Lift a proven Rule into docs/capabilities/

Review (per review):
  explain             Human-readable contract review summary
  brief               Compatibility alias for the contract view

Library governance (periodic):
  audit               Health check of the contract library
  graph               Dependency graph of the contract library

Probe & AI (on trigger):
  check-structure     Forbid a reference within a file glob
  resolve-ai          Merge external AI decisions into a report
  measure-determinism [Experimental] Measure verification determinism
```

## Core Flow

```bash
# 1. Create the goal (contract skeleton only — staged birth)
docwright init --kind feature --name "My Goal"

# 2. Research when triggered, then author the contract (see docwright-research)
docwright research docs/features/my-goal/spec.md --code .

# 3. Read the contract; plan births plan.md and tasks.md
docwright contract docs/features/my-goal/spec.md
docwright plan docs/features/my-goal/spec.md --code . --out docs/features/my-goal/plan.md

# 4. Implement, then verify
docwright lifecycle docs/features/my-goal/spec.md --code . --format json

# 5. Repo-wide guard, machine-stamped commit
docwright guard --spec-dir docs --code .
docwright stamp docs/features/my-goal/spec.md --code . --dry-run

# 6. Graduate and promote durable rules
docwright finish docs/features/my-goal/spec.md --code .
docwright promote docs/features/my-goal/spec.md --rule <id> --to <capability> --code .
```

## integrate / research / finish

```bash
docwright integrate                 # adoption: skills + policy blocks into a project
docwright research <goal>/spec.md --code .   # scaffold/refresh research.md
docwright finish <goal>/spec.md --code .     # graduation: verify, then remove consumables
```

`finish --retire <goal>/spec.md` withdraws the whole goal. `promote`
writes capability specs to `docs/capabilities/<name>.spec.md`.

## contract

```bash
docwright contract <spec> [--format text|json]
```

Renders the Task Contract with: Intent, Must/Must NOT, Decisions, Boundaries, Completion Criteria.

## lifecycle

```bash
docwright lifecycle <spec> --code <dir> \
  [--change <path>]... \
  [--change-scope none|staged|worktree|jj] \
  [--ai-mode off|stub] \
  [--min-score 0.6] \
  [--format text|json|md] \
  [--run-log-dir <dir>] \
  [--adversarial] \
  [--layers lint,boundary,test,ai,complexity] \
  [--resume[=conservative]] \
  [--review-mode auto|strict]
```

Full pipeline: lint -> verify -> report. Default format is `json`.

`lifecycle` honors `--format json` (machine-readable) and `--format md`/`markdown`;
any other value (including `compact`/`diagnostic`) renders as plain text. Use
`--format json` for retry-loop parsing.

New flags:
- `--resume` — skip already-passed scenarios (incremental mode)
- `--resume=conservative` — rerun all but detect regressions
- `--review-mode auto` (default) — treat `pending_review` as pass
- `--review-mode strict` — treat `pending_review` as non-passing

## guard

```bash
docwright guard \
  [--spec-dir docs] \
  [--code .] \
  [--change <path>]... \
  [--change-scope staged|worktree] \
  [--min-score 0.6]
```

Scans all `*.spec` and `*.spec.md` files in `--spec-dir`, runs lint + verify on each. Default change scope is `staged`.

## verify

```bash
docwright verify <spec> --code <dir> \
  [--change <path>]... \
  [--change-scope none|staged|worktree] \
  [--ai-mode off|stub] \
  [--format text|json|md]
```

Raw verification without lint quality gate. Default change scope is `none`.

## explain

```bash
docwright explain <spec> \
  [--code .] \
  [--format text|markdown] \
  [--history]
```

Human-readable contract review summary. Use `--format markdown` for PR descriptions. Use `--history` to include run log history. In jj repos, `--history` also shows file-level diffs between adjacent runs via operation IDs.

## stamp

```bash
docwright stamp <spec> [--code .] [--dry-run]
```

Preview git trailers (`Spec-Name`, `Spec-Passing`, `Spec-Summary`). Currently only `--dry-run` is supported.

In jj repositories, also outputs `Spec-Change:` trailer with the current jj change ID.

## lint

```bash
docwright lint <files>... [--format text|json|md] [--min-score 0.0]
```

Built-in linters: VagueVerb, Unquantified, Testability, Coverage, Determinism, ImplicitDep, ExplicitTestBinding, Sycophancy.

## init

```bash
docwright init --kind feature|issue|architecture [--root docs] --name <goal>
```

Both `--kind` and `--name` are required. Init creates a DeepChat-style goal
package: feature and architecture receive `spec.md`, `plan.md`, and
`tasks.md`; issue receives `spec.md`. Generated structural keywords are
English-only.

## Change Set Defaults

| Command | `--change-scope` default |
|---------|-------------------------|
| verify | `none` |
| lifecycle | `none` |
| guard | `staged` |

## resolve-ai

```bash
docwright resolve-ai <spec> \
  [--code .] \
  --decisions <decisions.json> \
  [--format text|json]
```

Merges external AI decisions into a verification report. Used as step 2 of the caller mode protocol:
1. `lifecycle --ai-mode caller` emits pending requests to `.docwright/pending-ai-requests.json`
2. Agent analyzes scenarios and writes `ScenarioAiDecision` JSON
3. `resolve-ai` merges decisions, replacing Skip verdicts with AI verdicts

The decisions file format:
```json
[
  {
    "scenario_name": "场景名称",
    "model": "claude-agent",
    "confidence": 0.92,
    "verdict": "pass",
    "reasoning": "All steps verified"
  }
]
```

Cleans up `pending-ai-requests.json` after successful merge.

## AI Mode

- `off` (default) - No AI verification layer
- `stub` - Returns `uncertain` for all scenarios (testing/scaffolding)
- `caller` - Agent-as-verifier: emits `AiRequest` JSON, resolved via `resolve-ai`
- `external` - Reserved for host-injected `AiBackend` trait implementations

## Verification Layers

Use `--layers` to select which verification layers to run:

```bash
# Only lint and boundary checking
docwright lifecycle docs/features/<goal>/spec.md --code . --layers lint,boundary

# Skip lint, run structural + boundary + test
docwright lifecycle docs/features/<goal>/spec.md --code . --layers boundary,test
```

Available layers: `lint`, `boundary`, `test`, `ai`, `complexity`

## graph

```bash
docwright graph \
  [--spec-dir docs] \
  [--format dot|svg]
```

Scans all spec files in `--spec-dir`, extracts `depends` and `estimate` from frontmatter, and generates a DOT dependency graph.

- Nodes use `box` shape (pending) or `doubleoctagon` (completed, tagged `done`/`completed`)
- Node labels include spec name + estimate (e.g., `"Goal Gate\n[0.5d]"`)
- Edges represent dependency relationships
- Critical path edges highlighted in red (`color=red, penwidth=2.0`)
- `--format svg` pipes DOT through system `dot` command (requires graphviz installed)

Example:

```bash
# Generate DOT and view
docwright graph --spec-dir docs

# Generate SVG
docwright graph --spec-dir docs --format svg > deps.svg
```

## BDD-spine Commands (0.3.0)

Additive commands from the BDD-spine release. Verdict semantics and `is_passing`
are unchanged; these are sensors (lint / report / audit), not new gates.

### matrix

```bash
docwright matrix <SPEC> \
  --code <CODE> \
  [--change <PATH>] [--change-scope none|staged|worktree] \
  [--ai-mode off|stub|caller] \
  [--format text|json|markdown]
```

Renders the coverage matrix: **Rule × Scenario × Test × Verdict × Provenance**.
Provenance is `Computational` (mechanical evidence) vs `Inferential` (AI). Shares
`verify`'s change-set and ai-mode flags and default semantics. Scenarios with no
matching test surface as orphan rows.

### promote

```bash
docwright promote <SPEC> \
  --rule <RULE_ID> \
  --to <CAPABILITY_NAME> \
  --code <CODE>
```

Promotes a passing task Rule into `docs/capabilities/<name>.spec.md` (the
living-spec library). The promote gate requires the Rule's Examples to pass and
at least one Example to exist. The Rule's stable `id` is preserved across the
lift — only its scope changes (Task → Capability). The capability name is
path-traversal-checked.

### audit

```bash
docwright audit [--spec-dir docs] [--format text|json]
```

Mechanically aggregates spec-library health: `spec_count`, `rule_count`,
`scenario_count`, `unproven_rules` (Rules with no proving Example),
`ungrouped_scenarios` (scenarios under no Rule), `open_questions`,
`malformed_rules`. **Observability only — never gates / never changes exit code
on health.** Reuses the same resolved/malformed definitions as lint/parser.

### discover

```bash
docwright discover --from-codebase \
  --code <DIR> \
  --name <SPEC_NAME> \
  [--out <FILE>]
```

Reverse-engineers a draft task spec from existing Rust test functions: one
`Test:`-bound scenario per test, placeholder When/Then steps, plus a `## Questions`
seed flagging the draft as auto-generated and needing human refinement. The draft
is guaranteed parseable. Cold-start aid only — it is NOT a finished contract.
Prints to stdout unless `--out` is given.

### check-structure

```bash
docwright check-structure \
  --code <DIR> \
  --forbid <SUBSTRING> \
  --in <FILE_GLOB>
```

Mechanical layering guard (dependency-cruiser-lite): fails (non-zero exit) if any
file matching `--in` contains `--forbid`. Example: forbid `clients/**` from
referencing `crate::services`:

```bash
docwright check-structure --code src --forbid crate::services --in "clients/**"
```

`**` matches across directories, `*` matches a single path segment.

### gen-integrations

```bash
docwright gen-integrations \
  [--target agents|cursor|claude|all] \
  [--out <DIR>] \
  [--check]
```

Generates per-tool integration files (agents / cursor / claude) from a single
source. `--check` compares on-disk files to what would be generated and exits
non-zero on drift — use it as a CI drift gate. Write and check share the same
renderer, so "check passes" is equivalent to "write is a no-op".

## Frontmatter: depends and estimate

Spec-level dependency and effort fields in frontmatter:

```yaml
spec: task
name: "检查点与增量重跑"
inherits: project
tags: [bootstrap, lifecycle, phase8]
depends: [task-goal-gate, task-context-fidelity]
estimate: 1d
---
```

- `depends`: list of spec file stems or spec names this spec depends on
- `estimate`: effort estimate string (`0.5d`, `1d`, `2d`, `1w`, `4h`)
- Both fields are optional; specs without them still work normally
- Used by `docwright graph` to generate dependency visualization and critical path

## Six Verdicts

| Verdict | Meaning | Action |
|---------|---------|--------|
| `pass` | Scenario verified | No action needed |
| `fail` | Scenario failed verification | Read evidence, fix code |
| `skip` | Test not found or not run | Check `Test:` selector matches a real test name |
| `uncertain` | AI stub / manual review needed | Review manually or enable AI backend |
| `pending_review` | Test passed but needs human review | Human reviews, or `--review-mode auto` treats as pass |

## Scenario DSL Extensions

### Critical tags (Goal Gate)

```spec
Scenario: 用户注册成功（critical）
  Tags: critical
```

- `critical` scenarios failing → `gate_blocked=true` in JSON, exit code 2
- Name suffix `（critical）`/`(critical)` also works as shorthand

### Review mode

```spec
Scenario: 安全审核
  Review: human
```

- `Review: human` → verdict becomes `pending_review` when test passes
- `--review-mode auto` (default): treats as pass; `--review-mode strict`: treats as non-pass

### Optimize mode

```spec
Scenario: 性能优化
  Mode: optimize
```

- `Mode: optimize` → scenario listed in `optimization_candidates` when pass
- Fail still blocks `passed: false` (optimize is a floor, not a ceiling)

### Scenario dependencies

```spec
Scenario: 用户登录
  Depends: 用户注册
```

- `Depends:` → lifecycle executes in topological order
- Prerequisite fail → dependent scenario auto-skipped with evidence
- Circular dependencies detected by lint
