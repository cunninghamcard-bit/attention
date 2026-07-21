spec: task
name: "kernel integration"
inherits: project
tags: [architecture, kernel, transport]
estimate: 5d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Give the Go kernel (cmd/ + internal/, the agent brain seated at the repo
root by monorepo-restore) a server shell and a product seam, so a persistent
agent survives its window: an Echo HTTP facade plus one WebSocket push
channel in front of the kernel's existing RPC command surface, an OpenAPI
contract generating `@app/sdk`, and a chat client in the workbench speaking
only that SDK. Remote-first: the server workspace is THE primary data path
for every client; local direct-read is a desktop capability, not a
foundation. The vertical slice that proves the architecture: talk to a
persistent agent, close the window, reopen — the session is still there.

## Doctrine (owner-set, 07-21)

- **Remote-first.** Desktop and web are the same thin client on the same
  code path (`RemoteDataAdapter` + SDK). Desktop is NOT special; at most it
  ADDS the capability of opening a local folder. The old "vault fs stays
  in-process" line was migration-scope protection, not product doctrine.
- **Authority splits by domain, not globally.**
  - vault/workspace content: FILE-FIRST — files are the truth. The whole
    Obsidian-reconstruction UI, editor, links and plugin API assume it.
  - agent memory/sessions/config: DB-AUTHORITATIVE, with a Markdown
    PROJECTION into the workspace (memoh's wikistore pattern: DB is truth,
    derived .md views, explicit rebuild/ingest, no fs watchers).
- **The kernel is the host-brain** (memoh's cmd/agent analog, NOT the
  in-container bridge). Host discipline inherited: the kernel never makes
  direct os calls against the workspace — all file access goes through the
  narrow fs port below.

## Decisions

- **Transport (frozen in monorepo-restore, restated):** Echo HTTP facade
  (`cmd/` serves, `internal/handlers/` routes, swaggo → swagger.json) plus
  ONE WebSocket push channel. The kernel's existing bidirectional RPC
  command surface (Prompt/Steer/FollowUp/Abort/NewSession/SwitchSession/
  Fork/…) is the semantic layer; only the transport is lifted. OpenAPI
  generates `@app/sdk`; the renderer's APP layer consumes the SDK directly.
  Pi-RPC stays kernel-internal (the TUI remains its client, never crosses
  into JS).
- **The narrow fs port (memoh `bridge.Client` analog):** one Go interface —
  ReadFile/WriteFile/ListDir/Stat/Mkdir/Rename/Delete (+Exec for git/pty
  hosts). Every server-side consumer (HTTP file handlers, the kernel, the
  memory projector) goes through it; nothing calls `os` against the
  workspace directly. v1 implementation = direct local fs on the server
  host; phase 2 (sandboxing) = a bridge implementation into the agent's
  container — an implementation swap behind an unchanged interface.
  (Correction on record: memoh's storage.Provider/localfs/containerfs is
  its MEDIA object storage, not this seam — the vault seam is
  bridge.Client. Verified against source, 07-21.)
- **Reserved projection subtree (the boundary nail):** DB→Markdown
  projections live ONLY under `.attention/memory/`. The rebuild
  (DB→files) writes only inside that subtree and never touches the vault;
  vault watching/reconcile never manages the projection subtree. Projection
  files are linkable and browsable as normal notes but are marked as
  derived views ("edits here are overwritten; edit agent memory instead").
  Violating either direction is a data-loss bug by definition.
- **Sync primitives split by domain, like authority (decode-obsidian
  forensics, 07-21 — each domain uses the primitive its direct precedent
  validated):**
  - **vault domain (file-first) = Obsidian-style:** a server-side
    monotonically increasing version uid acts as sync cursor and replay
    log; clients hold the cursor, reconnect with it and replay everything
    newer; live changes arrive by WebSocket push (no polling, no remote
    fs-watch). Content moves as whole files (chunked), deduplicated by
    content hash. Conflicts are MERGE-FIRST: automatic three-way text
    merge (diff-match-patch family), and only on failure a conflicted
    copy is kept and surfaced — never a silent last-writer win.
  - **agent-memory domain (DB-authoritative) = memoh-style:** content-hash
    optimistic writes — stale base hash → HTTP 409 with the current hash.
    Fits request/response DB data.
  - Clients never cache file CONTENT locally: disk (local vault) or the
    server workspace is the only content truth; client-side storage holds
    only the sync cursor, rebuildable indexes and pre-overwrite backups.
  - Trust posture, stated: Obsidian affords file-first sync with a
    non-authoritative server via zero-knowledge E2E encryption. We run our
    OWN trusted server and store the workspace in plaintext — acceptable
    because the server is the user's, not a third party; revisit only if
    hosting for others.
  - The temp+rename/reconcile machinery remains only inside the desktop
    local-folder capability, where genuine external writers exist.
- **Per-method transport semantics (the table rides in `@app/shared` doc
  comments; the three that redefine):**
  - `getFullPath`/`getResourcePath` → transport-agnostic resource
    references: remote = server HTTP URL, local = file path. Contract: the
    return value is directly feedable to src/href; callers may not assume
    a disk path.
  - `terminalApi.spawn` → async. `platform`/`defaultShell`/`homeDir`
    become SESSION-HOST properties delivered at handshake (remote = the
    server's machine), not synchronous local reads.
  - `gitApi.exec` `cwd` = workspace-relative; each adapter resolves it on
    its own host.
- **Capability detection:** a capability = "is an adapter registered for
  this port", never platform sniffing. Absent capability = the UI entry is
  not rendered (graceful absence), and each absence is pinned by a
  regression test. First use case: the desktop-only "open local folder"
  entry.
- **The wall, machine-enforced:** "rendering never imports @app/sdk"
  (shared pure-UI/rendering packages may not import the SDK; the app
  layers of apps/desktop and apps/web may) ships as an oxlint
  no-restricted-imports rule inside the mise lint battery, not as prose.
- **Plugins split (restated):** UI plugins stay client-side unchanged;
  agent-capability extensions are server-side via MCP/Skill. The kernel's
  own md/JS plugin system continues as its capability surface.

## Boundaries

### Allowed Changes

- cmd/** and internal/** (facade, handlers, fs port, projection)
- packages/sdk/** (generated client), packages/shared/** (port semantics)
- apps/web/** (chat client, RemoteDataAdapter, capability registry)
- apps/desktop/** (server spawn/attach, local-folder capability)
- mise.toml, oxlint.json (gate wall rule), docs/**, tests/**, scripts/**

### Forbidden

- Do not let the kernel or any server code call os against the workspace
  outside the narrow fs port.
- Do not let rebuild write outside `.attention/memory/`, or vault
  reconcile manage inside it.
- Do not hand-write SDK code (`@app/sdk` is generated or empty).
- Do not import `@app/sdk` from shared pure-UI/rendering packages.
- Do not break the existing desktop experience: every current workflow
  keeps working while the seam grows beside it.
- Do not weaken, skip or delete existing tests to make a gate pass.

## Completion Criteria (P1 vertical slice)

### Rule: persistent-session — the slice that proves the architecture

Scenario: a session survives its window (critical)
Review: human
Test: keeps a session alive across client restarts
Given a running server and a chat session with at least one exchange
When the client is closed and reopened and the session list is fetched
Then the session appears with its history and can continue

### Rule: seam-purity — one SDK, one wall

Scenario: the renderer app layer speaks only the SDK
Test: keeps kernel access behind the generated SDK
Given all imports under apps/web and packages
When kernel-facing call sites are resolved
Then every one goes through @app/sdk, no rendering package imports it,
and the oxlint wall rule is present and enforced in the gate

### Rule: port-discipline — no direct os against the workspace

Scenario: server-side workspace access goes through the fs port
Test: keeps workspace access behind the fs port
Given cmd/ and internal/
When workspace file operations are searched
Then all of them route through the fs port interface and none calls
os functions on workspace paths directly

### Rule: projection-boundary — the two authorities never cross

Scenario: rebuild and reconcile stay in their territories (critical)
Test: keeps projection writes inside the reserved subtree
Given a rebuild run and a vault reconcile run
When their write and management sets are recorded
Then rebuild touched only .attention/memory/** and reconcile touched
nothing inside it

### Rule: optimistic-409 — stale writes on DB-authoritative data are refused

Scenario: a stale-base write is rejected (agent-memory domain)
Test: refuses writes whose base hash is stale
Given a DB-authoritative record changed since the client's last read
When the client writes with its stale base hash
Then the API answers 409 with the current hash and does not write

### Rule: vault-cursor — vault sync replays from a monotonic cursor

Scenario: a reconnecting client catches up by cursor
Test: replays vault changes newer than the client cursor
Given vault changes that happened while a client was disconnected
When the client reconnects presenting its last version uid
Then it receives exactly the newer changes by push and its cursor
advances to the server's latest uid

### Rule: gate-green — the full gate stays the standard

Scenario: the full gate passes with the new pieces (critical)
Review: human
Test: keeps the full gate green through kernel integration
Given the integrated tree
When the mise lint/typecheck/test/packcheck battery plus e2e and builds run
Then all pass with no test weakened, skipped or deleted

## Out of Scope

- Sandboxing/containers (phase 2 — the fs port and boxsh account are the
  prepared seam).
- The web deployment trio (auth, web packaging, hosting) beyond what the
  slice needs locally.
- Multi-user/tenancy, ACL.
- Migrating existing vault UI off the local adapter (remote-first lands
  for the NEW chat/agent surface first; the vault UI follows in the web
  ticket).
- MCP/Skill marketplace.

## Open Questions

1. Session/message store: SQLite (single-binary, local-first server) vs
   Postgres (memoh-parity) for v1.
2. The projection's ingest direction (manual command vs deliberate
   file-edit flow) — decide when agent memory lands.
3. Facade surface granularity (how much of the RPC command table the v1
   OpenAPI exposes vs holds back).
