# Kernel notes: lessons from Multica

Source: https://github.com/multica-ai/multica — an open-source managed-agents
platform (agents as teammates; board, comment threads, squads; 13 engine
adapters incl. Claude Code, Codex and Pi). Deep-dive performed 2026-07;
this note maps its mechanisms onto the along-go kernel plan.

## What it validates in our design (keep course)

- **The engine interface IS the whole ballgame.** Their `Backend.Execute →
  (Messages <-chan, Result <-chan)` with a small closed set of normalized
  message types (text/thinking/tool-use/tool-result/status/error) is our
  `Engine { run(prompt, emit); stop }` — every adapter (stream-json,
  JSON-RPC, ACP) converges to one shape and nothing downstream
  special-cases engines. Their `Result` is our `run.closed` (+usage).
- **Append-only seq-numbered event rows as the source of truth**, with the
  push channel demoted to a "something changed" nudge and clients
  re-fetching `since=seq`. Exactly our replay design; along-go persists
  `task_message`-style rows and SSE stays dumb.
- **Session continuity as (agent, thread) → engine session id + workdir**,
  resumed with the engine's own mechanism (`--resume`, persistent pi
  session). We already do both.

## What to adopt (deltas)

1. **Polymorphic actor columns from migration 1.** Every authorship or
   ownership column is a `(actor_type, actor_id)` pair with
   `type ∈ {member, agent, squad}` — this single pattern is what makes an
   agent a first-class teammate (assignee, author, subscriber) instead of
   a bolt-on. Consequence for our contract: `authorId` grows into
   `(authorType, authorId)` when the roster lands. Retrofitting later
   touches everything; do it in the first schema.
2. **Multi-agent conversation without a turn-taking scheduler.** Multica
   has no live "who speaks next" state machine. One shared comment/event
   stream; on each new message the SERVER deterministically computes
   triggers: explicit @mention enqueues for the mentioned agent; the
   assignee auto-triggers; replies route to the parent author; `@all`
   suppresses auto-triggers (broadcast, not request). Our 话轮层 v1 is
   therefore just trigger rules — no scheduler to design.
3. **Mentions carry UUIDs, not names** (`mention://agent/<uuid>`,
   regex-gated). A mention that can't resolve is dead on arrival instead
   of silently misrouted. Our UI mentions are plain text today; when the
   roster becomes state, serialize mentions with ids and keep rendering
   names.
4. **Loop-avoidance is two layers**: a hard server guard (skip enqueue if
   a task for that (thread, agent) is already pending) plus a soft prompt
   instruction injected only for agent-triggered turns ("if the triggering
   comment was just an ack and you produced no new work, stay silent").
   Neither layer suffices alone.
5. **Squad = a routing row, not an executor.** All squad-addressed work
   resolves to `leader_id`; the leader delegates by ordinary @mention
   comments, re-entering the same trigger pipeline. Rooms and squads live
   on ONE primitive. Their `no_action` activity-log signal (leader
   evaluated, chose silence, audited outside the visible thread) is worth
   copying verbatim.
6. **Daemon runtime discipline**: acquire the concurrency slot BEFORE
   claiming work (kills a class of dispatch-timeout bugs); idle-watchdog
   budgets grow while a tool call is in flight (slow docker build ≠ hung
   engine); per-adapter blocklists of protocol-critical CLI flags that
   user `custom_args` can never override.
7. **Skills are provider-native file drops** — write markdown into each
   engine's own discovery path (`.claude/skills/...`) at claim time; zero
   prompt plumbing.

## What we deliberately do differently

- Multica routes everything through issues/comments (a work tracker);
  our primary surface is the conversation itself (ChatView / rooms). Same
  kernel primitives, different product grammar.
- They run a daemon per user machine polling for claims (cloud-first);
  along-go starts as a local sidecar where transport is in-process — the
  claim protocol becomes relevant only when execution moves off-box.
- WS hub + Redis relay is their multi-node story; SQLite-first along-go
  keeps SSE + DB until a second node exists.

## Appendix A: adapter anatomy (how 13 engines become one)

The whole compatibility layer is one Go interface plus a closed message set:

```go
Backend.Execute(ctx, prompt, opts) -> Session{ Messages <-chan Message, Result <-chan Result }
Message.Type ∈ { text, thinking, tool-use, tool-result, status, error, log }
Result.Status ∈ { completed, failed, aborted, timeout, cancelled } + SessionID + Usage
```

- One file per engine; a factory switch (`New(agentType)`) picks the struct.
  Three transport families hide behind it: stream-json lines (claude),
  JSON-RPC over stdio (codex), and ACP (hermes/kimi/kiro/qoder/trae — the
  shared external spec makes those adapters thin).
- The claude adapter is a scanner loop over stdout lines dispatching on
  msg.Type; permission prompts (`control_request`) are auto-answered with
  `control_response{allow}` written back to stdin — headless mode is a
  protocol handshake, not a flag.
- ExecOptions carries the portable knobs (cwd, model, resume id, thinking
  level, mcp config); each adapter maps or IGNORES them (unsupported knob
  falls through rather than fails — lets capabilities grow per-engine).
- Failure forensics: a bounded stderr tail is attached to failure Results;
  exit-code vs ctx-deadline vs write-error disambiguation happens once per
  adapter, so "why did it die" is uniform upstream.

Mapping: this Session/Message pair is channel-shaped fn1 — our Engine
interface emits the same information as canonical events instead. When
along-go adds Codex/Copilot adapters they are one file each.

## Appendix B: the push pipeline (engine -> screen)

```text
engine subprocess (stdout lines / JSON-RPC / ACP)
  -> adapter normalizes to Message channel            [server/pkg/agent/*]
  -> daemon drain loop: coalesce adjacent text/thinking, flush on 500ms
     ticker or on any tool event; stamp per-run seq; batch    [executeAndDrain]
  -> HTTP POST ReportTaskMessages (batches)
  -> server appends to task_message rows (task_id, seq, type, ...)
  -> WS hub broadcast "task:message" to subscribers of scope task:<id>
  -> frontend: WS payload patches the query cache in place (setQueryData);
     history/reconnect = GET run-messages?since=<seq>; memoized rows so a
     streamed event re-renders only the tail
```

Their delta vs ours: they coalesce in the DAEMON (500ms batches — fewer,
fatter rows; good for HTTP hops), we coalesce in the CLIENT (rAF +
typewriter; finer deltas over SSE). Both keep the DB as source of truth
with seq as the resume cursor; the push channel is just a nudge with
payload. For along-go local sidecar the finer-grained SSE stays right;
adopt daemon-side batching only when the transport becomes a network hop.
