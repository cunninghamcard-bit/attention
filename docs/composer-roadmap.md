# Composer roadmap (from the arkloop study)

A reverse-engineering pass over arkloop's ChatInput (1624-line monolith +
chat-input/ subcomponents) sorted its capabilities into adopt / adapt / reject
for our CodeMirror-hosted composer. Source: arkloop web app, studied 2026-07.

## What CodeMirror already bought us

Roughly a third of arkloop's composer code hand-solves editor problems:
auto-resize measurement, IME composition guards, cursor save/restore across
layout shifts, popup positioning and keyboard navigation for the slash menu.
All of that is CM6 core or our autocomplete pipeline. Zero code, already done.

## Adopt (planned, in priority order)

### P1 — Paste triage + attachment cards (in-memory)

arkloop's paste pipeline, the single highest-value pattern:

```text
paste event
  ├─ has files            -> attachment flow (rate-limited 1/s)
  ├─ text >= 20 lines     -> becomes an attachment card, not inline text
  └─ multi-blank-line text -> collapse \n{2,} -> \n, insert inline
```

Long agent-prompt pastes staying out of the editable draft is what keeps the
composer usable. Requires the send payload to grow from `text` to parts:
`sendMessage({ text, attachments })` — the canonical event model already has
room (user message = Part[], attachment part type).

Decision (revised during review): attachments are composer memory, exactly
like arkloop — a ChatAttachmentBar component owns the list, cards render
above the editor, content ships with the payload. A vault-file-backed
variant (paste writes a note, draft holds ![[embed]], Obsidian's
pasted-image pattern) was designed and rejected: it creates vault files
before the user ever sends, accumulates orphans with no reclaim story, and
conflates transient chat drafts with the knowledge base. Vault integration
stays where it already works — [[wikilinks]] the user types deliberately.

### P2 — Draft persistence + input history

arkloop keys drafts by a 6-tuple (owner, page, threadId, mode, search) with a
7-day TTL and LRU eviction, and keeps a 50-entry deduplicated input history
navigated with ArrowUp/Down at the doc edges.

Our mapping: scope = threadId (localStorage, TTL); leaf ephemeral state keeps
only cursor/scroll. History navigation is a CM keymap entry; the draft store
is a small module next to ChatTransport. The lesson worth keeping verbatim:
drafts belong to the *thread*, not to the leaf — closing a tab must not eat
a draft.

### P3 — Attachments, reference-first

arkloop uploads files to its backend; our host is a knowledge app, so the
primary attachment is a *reference*: `[[note]]` links (already completing),
vault paths, workspace files. Contract copied from arkloop regardless of
kind: the view owns attachment state, the composer renders cards and fires
add/remove callbacks. Upload-style attachments wait for the along-go backend.

### P4 — Queued input while streaming

arkloop allows typing during a run and editing a queued prompt (send stays
enabled only for the queued edit; stop button otherwise). Good UX, but it
adds queue semantics to the canonical event contract, so it lands together
with the along-go backend, not before.

## Adapt (same need, different mechanism)

- Slash highlighting and token-boundary cursor snapping (arkloop: hand-rolled
  overlay + selection math) -> a CM decoration/atomic-range extension, and the
  first demo plugin for registerChatComposerExtension.
- Mode chips / model picker (arkloop: PersonaModelBar) -> not composer UI in
  an Obsidian-shaped app; model/persona selection belongs to the view header
  or settings, and the actual model contract belongs to the backend.

## Reject

- Typewriter placeholder animation — decoration without function.
- Work-mode compact/expanded layout machine — our composer has one layout.
- Voice input — possible later as a plain composer action plugin; nothing in
  the core needs to know about it.

## Structural lesson

The monolith failed at the seams we already cut: arkloop keeps draft state,
attachment rendering, popup state, mode state and layout state in one
component because React co-locates state with rendering. Our composer stays
small only if every P1–P3 feature arrives as its own Component with an
explicit contract (PastedContentCard, AttachmentBar, DraftStore) wired
through the existing registries — never as new state inside ChatComposer.
