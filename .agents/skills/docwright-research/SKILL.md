---
name: docwright-research
description: Demand-driven research and learning before contract authoring. Use when a spec carries clarification markers that reading the code cannot resolve, when the goal's domain is unfamiliar, or when another skill needs the investigation or grill protocol. Invoked by docwright-sdd at its research step.
---

# Agent Spec Research

Two protocols: **investigate** (the agent pays with legwork) and **grill**
(the user pays with understanding). Both are demand-driven — never research
as ritual. Triggers: a bracketed NEEDS-CLARIFICATION marker that exploring
the codebase cannot resolve, or a domain unfamiliar to the team. The
`research-required` lint enforces the first trigger mechanically.

## Investigate

1. Run `docwright research <goal>/spec.md --code .` — this scaffolds
   research.md beside the spec and fills its Current Codebase State managed
   region. Re-run any time; only the managed region is overwritten.
2. Answer every Unknown against **primary sources** — official docs, source
   code, specs — never a secondary write-up, and never your parametric
   knowledge. Follow every claim back to the source that owns it, and cite
   that source on the claim.
3. For fast-moving ecosystems, search instead of remembering. The GitHub
   toolkit, in order:
   - `gh search repos --topic <t> --sort stars` — find the players and their scale
   - `gh api "repos/<r>/git/trees/<branch>?recursive=1"` — map a repo without cloning
   - `gh api repos/<r>/contents/<path>` — read the implementation itself
   - `gh search code --repo <r> "<term>"` — find conventions in the wild
   - issues and discussions — recover the design rationale behind the code
4. Compare multiple implementations before concluding; one project is an
   anecdote. Record each Finding as **Decision / Rationale / Alternatives
   considered**, with sources.
5. Remove every `[UNFILLED` placeholder — the `research-unfilled` lint
   stays noisy until you do.

## Grill (the learning half)

The user must understand both the industry norms and the codebase state —
that cost cannot be delegated. After research.md is complete:

1. **Teach before asking.** Walk the user through what the research
   found — both halves: our own codebase and others' practice — with live
   demos where possible, until they say it is clear. A decision made
   before the teaching completes is invalid and must be re-grilled
   (this rule was learned the hard way; see workflow-refactor records
   0003/0006).
2. Put each Finding's Decision to the user **one at a time**, with your
   recommended answer. Facts you can look up yourself — decisions are the
   user's.
3. The moment a round is confirmed, write it to
   `<goal>/learning-records/NNNN-<dash-case-topic>.md`: the question, the
   recommendation, the user's answer, and what it overrides. Do not batch
   records at the end.
4. Confirmed decisions flow into spec.md's Decisions, citing research.md.
5. Do not begin authoring spec.md until every Finding has been grilled.

## Linkage

- `docwright-sdd` invokes this skill at its research step.
- `docwright-authoring` consumes grilled decisions into the Decisions
  section; cite research.md so the `research-uncited` lint stays quiet.
- `docwright-tool-first` documents the `research` command surface.
- At graduation, `finish` archives research.md and learning-records/ into
  `docs/learning/<goal>/` — the household's decision-archaeology layer;
  durable conclusions must still live in the contract itself.
