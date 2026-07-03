# The ownership flip: from reconstruction to product

The endgame is a COMPLETE application — an agent workbench that carries
Obsidian's architecture — not a perpetual clean-room reconstruction with an
agent branch bolted on. That transition has a name here: the ownership
flip. It is a deliberate one-way door, taken once, not drifted through.

## What "parity phase" buys us today

- `src/styles/app.css` (barrel + 57 partials) is a FROZEN vendor artifact,
  locked by the golden SHA-256 in `src/styles/app-split.test.ts`. It is the
  spec: any rendering difference is our bug, never style drift.
- Real Obsidian themes work unchanged — variables and selectors match
  byte-for-byte.
- New builtin styles (chat, agent views) ride the managed CustomCss channel
  (`builtin:chat`) instead of touching the artifact.

## The flip, when the product decides it is an agent workbench first

1. Cut the golden hash — partials become authored source; app.css becomes
   build output. (The 57-way semantic split already done on main is the
   precondition: readable first, owned second.)
2. Prune dead partials the product does not ship (pdfjs viewer, publish,
   sync, mobile as applicable).
3. Promote `03-foundations-tokens` to the design system's source of truth;
   owned components draw from it.
4. Fold `builtin:chat` into an authored partial (e.g. `58-agent-chat.css`);
   the CustomCss channel reverts to user CSS / themes / snippets only.

## The price, stated up front

Cutting the hash permanently retires the parity oracle: diffing renders
against real Obsidian gets much harder, and theme compatibility drops from
guaranteed to best-effort. That is why the flip waits for the product
decision instead of happening as cleanup.

## Discipline until then

Chat/agent CSS depends only on the artifact's public variables
(`--interactive-accent`, `--background-modifier-border`, …), each with a
fallback — never on its internal implementation details. Flip day then
moves CHAT_CSS into a partial as a mechanical step, nothing more.
