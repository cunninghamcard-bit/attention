# The data layer: one replicated store, three heads

Date: 2026-08-02
Status: draft for review

## Problem

Every byte this app persists today assumes a single desktop machine. Vault
content goes through `FileSystemAdapter` over Electron IPC; the browser build
gets `InMemoryAdapter` and loses everything on refresh. The metadata cache
lives in one browser profile's IndexedDB. There is no server form, no second
device, no second user.

The product goal is the opposite shape: a **hosted multi-user service** plus
a **desktop app** plus a **web app**, all working on the same data — offline
capable, converging when online.

## Decision

Local-first replication on CRDTs, with a database at every tier.

```
              Server — a rented, always-on machine running two programs
              ┌─────────────────────────────────────────────┐
              │ attentiond (ours, Go)      Postgres (stock)  │
              │  serves the web build   →  accounts, vaults, │
              │  accounts, sync relay      opaque doc bytes  │
              └───────────┬───────────────────┬──────────────┘
                   sync   │                   │   sync
            ┌─────────────┴──┐          ┌─────┴───────────┐
            │ Desktop        │          │ Web             │
            │ IndexedDB      │          │ IndexedDB       │
            │ loro-crdt WASM │          │ loro-crdt WASM  │
            └────────────────┘          └─────────────────┘
```

- **CRDT layer: [loro](https://github.com/loro-dev/loro)** (`loro-crdt@1.13.9`,
  verified against its shipped `.d.ts`, not from memory). Its movable tree is
  the vault hierarchy; its text CRDT is note content; import is idempotent,
  which the whole sync design leans on.
- **Wire protocol: [loro-protocol](https://github.com/loro-dev/protocol) v1**,
  loro's official transport-agnostic sync protocol — not a protocol of our
  own. Rooms multiplex on one WebSocket; 256 KB frames with fragmentation;
  Ack delivery semantics; the join payload is application-defined (our auth
  token rides there); versions are opaque bytes. The official TS packages
  (`loro-websocket`, `loro-adaptors`) are the client side. The server side is
  a **Go port of the wire codec** (a few hundred lines from `protocol.md`,
  cross-tested against the official TS implementation) — chosen over a
  Node/TS server after weighing both: one backend stack, one binary, and the
  Memoh template applies end to end.
- **Server database: Postgres, only.** No SQLite second backend — the
  exemplar (Memoh) runs Postgres for dev and prod alike via docker compose,
  and one backend is less code than two behind an interface.
- **Client database: IndexedDB** on both desktop and web. The replica layer
  is written once in `apps/web`, which both heads already share. Desktop
  gains no native data dependency.
- **Server engineering shape: copied from Memoh** (`~/Projects/Memoh`), which
  the same monorepo layout makes directly transplantable: sqlc + migrations
  as the schema's single source, echo + JWT, swagger → `@hey-api/openapi-ts`
  → a generated TS SDK in `packages/sdk`, docker-compose deployment, mise
  codegen task chain.

### The invariant that keeps the server small

**The server never interprets document bytes.** Updates, snapshots and blobs
are opaque; there is no loro dependency in Go, ever — merging happens only on
clients, where CRDT math makes convergence order-independent. loro-protocol
explicitly supports this stance (its %ELO E2EE mode is *defined* as a server
that cannot decrypt), it means the hosted service cannot read user notes, and
it makes client-side E2E encryption a later add that touches no server code.

Corollary: **derived data never syncs.** Metadata cache, link graph, search
index are recomputed per client and keep their existing
`MetadataCachePersistentStore` seam.

## Data model — how a vault splits into documents

A loro doc is the unit of loading, syncing, history and compaction, so the
split follows those four seams. Per vault:

| Data | Representation | Room |
|---|---|---|
| File hierarchy | one **movable-tree doc**; `LoroTreeNode.creationId()` (peer+counter) is the file's identity, stable across rename/move | one room per vault, joined first at boot |
| Text file content | one **text doc per file**, keyed by the tree node id | one room per file, joined lazily in batches |
| Binary files | content-addressed **blobs** (`hash → bytes`) referenced from tree node `data`; not CRDTs | HTTP `PUT/GET /blobs/{hash}`, not WS |
| Derived caches | local-only, never synced | — |

One-doc-per-vault was considered and rejected — structurally possible
(`node.data` is a `LoroMap`, and `map.setContainer("text", new LoroText())`
nests, verified), but a single doc means whole-vault memory on open (fatal in
a browser), entangled history, all-or-nothing compaction, and one undo stream
across every file. Per-file docs give lazy loading, per-file `UndoManager`
(the editor's actual semantics), and per-file compaction.

Named cost: a 10k-file vault means 10k room joins at boot. The tree room
joins first so the file tree renders immediately; text rooms join in
background batches, each join costing only a room id and version bytes. At
100k files revisit with aggregation.

Vault kinds coexist at the existing `DataAdapter` seam — the injection point
is already there (`App.ts` takes `takeNextAppAdapter() ?? new
InMemoryAdapter()`):

- **Local folder** — `FileSystemAdapter`, desktop only, exactly as today.
- **Synced vault** — new `LoroDataAdapter`. The filesystem's role for synced
  vaults is one-time **import** (and later export); no live FS bridge.

## Client: `apps/web/sync/`

```
VaultDocs.ts        loro docs: the tree doc + per-file text docs, lazily instantiated
SyncStore.ts        IndexedDB persistence (+ Memory variant for vitest,
                    following the MetadataCacheStore precedent — no fake-indexeddb dep)
LoroDataAdapter.ts  the DataAdapter implementation
FolderImport.ts     eat an existing folder into a synced vault once
SyncClient.ts       thin room orchestration over the official loro-websocket client
```

`loro-crdt` is a 3.2 MB WASM; the import stays dynamic (the restty
precedent). IndexedDB per vault, `{vaultId}-sync`, object stores mirroring
the server's shape (snapshot + log, one mental model at every tier):

| store | key | holds |
|---|---|---|
| `docs` | docId | consolidated snapshot bytes |
| `updates` | auto | `{docId, bytes, local, pushed}` — WAL, both origins |
| `blobs` | hash | attachment bytes |
| `meta` | fixed | vault info (no sync cursor — the doc's own version is the cursor, exchanged at room join) |

Data paths:

- **Write**: `Vault.modify` → adapter → text doc →
  `subscribeLocalUpdates((bytes) => ...)` hands the update bytes directly
  (no manual version bookkeeping) → append to WAL → push; ack marks pushed.
- **Boot**: tree doc eagerly (snapshot + WAL replay); text docs on first
  read.
- **Remote update for a cold doc**: append bytes to WAL and do nothing —
  no instantiation, no merge until the file is next opened. Memory stays
  proportional to open files, not vault size.
- **Remote update for a live doc**: `import` → subscription →
  **the adapter emits the same file events a disk change would** — Vault,
  MetadataCache and every view react as if the file changed on disk. No
  second collaboration pipeline exists.
- **Compaction**: when a doc's WAL grows past a threshold, export
  shallow-snapshot (history-trimming, verified API) into `docs`, clear its
  WAL rows; the same export is uploaded out-of-band over HTTP so the server
  can truncate the room log.
- **Editing before the editor binding lands**: `LoroText.update(text,
  {useRefinedDiff})` diffs internally — full-text writes already produce
  minimal ops. `loro-codemirror@0.3.3` then binds CM6 at the
  `EditorExtension` seam; it is ten months behind an actively-moving core
  (peers `^1.8.2`, core at 1.13.9), so the editor phase budgets for vetting
  or vendoring it, with `update()` as the fallback.

## Server: `attentiond`

One Go binary in this module, deliberately not part of `along` (a deployed
sync server must not drag the agent harness):

```
cmd/attentiond/                the deployable
db/postgres/migrations/        schema's single source, golang-migrate, embedded
db/postgres/queries/           hand-written SQL
internal/db/postgres/sqlc/     generated, never hand-edited
internal/syncd/                loro-protocol codec port, rooms, hub, WS handler
internal/accounts/             registration, login, sessions, membership
internal/server/               echo shell, routes, middleware, swagger annotations
packages/sdk/                  generated TS client (openapi-ts), consumed by apps/web
docker-compose.yml             postgres + attentiond
```

Routes: `GET /` (the web build — the Web head), `GET /sync` (WS,
loro-protocol), `PUT|GET /blobs/{hash}`, REST for accounts/vaults (OpenAPI →
SDK). The deferred PTY server mounts here later, same shell, same auth.

**Dumb-server conformance.** loro-protocol lets the receiver decide how to
compute backfill. v1: on join, send the stored snapshot + subsequent log
entries wholesale, ignoring the client's version bytes — idempotent import
makes redundancy a bandwidth cost, never a correctness one. Later
optimization, if measured to matter: index update-header version ranges
(header parsing, still not CRDT semantics). Room log truncation happens only
via the out-of-band snapshot upload.

Schema:

```sql
-- control plane (auth is stateless JWT, the Memoh model — no session rows)
users         (id, email, pass_hash, created_at)
vaults        (id, owner_id, name, created_at)
vault_members (vault_id, user_id, role)            -- owner | editor

-- data plane, payloads opaque
rooms    (vault_id, room_id, crdt_type, snapshot BYTEA, snapshot_at,
          PRIMARY KEY (vault_id, room_id))
room_log (vault_id, room_id, n BIGINT, bytes BYTEA, received_at,
          PRIMARY KEY (vault_id, room_id, n))       -- n is storage order, not wire-visible
blobs    (vault_id, hash, bytes BYTEA, size, PRIMARY KEY (vault_id, hash))
```

Auth: argon2id at rest; stateless JWT exactly as Memoh does it
(`/auth/login` + `/auth/refresh`, echo-jwt middleware with a path skipper).
Two carriers, one secret: HTTP requests use the Authorization header; the
WS path cannot (browsers give the WebSocket API no custom headers), so each
loro-protocol `JoinRequest.Auth` carries the JWT and syncd validates per
room join — `loro-websocket`'s `join({auth})` provider exists for exactly
this. `vault_members` gates every room of a vault. Origin checked on
upgrade; TLS is the reverse proxy's job; guardrails from day one (max
message/blob size, per-connection rate limit — the protocol's Ack status
codes carry `rate_limited` and `payload_too_large` natively).

## Phases

Client and server proceed in parallel; nothing waits.

| # | Delivers | Verified by |
|---|---|---|
| C1 | `SyncStore` (Memory + IDB) + `VaultDocs` | pure-data vitest |
| C2 | `LoroDataAdapter` | the existing Vault test suite, run as-is against it |
| C3 | `FolderImport` + open-synced-vault wiring | end-to-end open in the app |
| C4 | `SyncClient` over loro-websocket | against the real attentiond from day one |
| S1 | migrations + queries + sqlc + migrate bootstrap | storage tests on compose PG |
| S2 | protocol codec port + rooms/hub | cross-tested against the official TS client |
| S3 | echo shell: routes, blobs, static hosting | httptest |
| S4 | accounts/auth/ACL | control-plane tests |
| S5 | swagger → `packages/sdk`, renderer wired | the type chain compiles; convergence is
      tested continuously (two clients through a compose-launched server), not at a
      final integration event |

Dev loop: `mise run server:dev` = compose up (PG + attentiond). Integration
tests that need the pair live in their own lane and skip when compose is
absent (Memoh's `TEST_DATABASE_URL` pattern).

## Ceilings, named

- **Multi-node broadcast** needs a pub/sub (PG LISTEN/NOTIFY first); one
  node carries thousands of WS connections; not built until needed.
- **Blobs in Postgres** are fine to start; S3-compatible storage slots in
  behind the blob queries when volume demands.
- **E2E encryption** = loro-protocol's %ELO, specified by upstream; shared-
  vault key exchange deferred with it.
- **100k-file vaults** need room aggregation at boot; 10k is fine.
- **Kernel session data** (agent sessions/messages) is a separate domain,
  deliberately outside these phases.

## Not in scope

Billing, quotas, abuse handling, mobile heads, live FS mirroring, selective
`.obsidian` sync, per-vault settings sync.
