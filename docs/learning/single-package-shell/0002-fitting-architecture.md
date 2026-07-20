# 0002 — The fitting architecture is the one we already have (drop Presenter, drop SiYuan-vault)

**Research (parallel deep-read of SiYuan + Obsidian ref, synthesized):** the
architecture that fits attention is a VS Code / Obsidian workbench — a fat,
node-privileged renderer over a ports-and-adapters native seam where the shell
implements the ports and the renderer never imports the shell. **We already
have it; nothing structural needs redoing.**

**Two references, both partly rejected:**

- **DeepChat presenter/route/zod** — DROP. It polices an untrusted,
  secret-holding, dozens-of-capability _sandbox_. We are a trusted renderer
  with a ~7-capability first-party seam; the machinery is pure overhead. A
  typed channel table in `src/shared` gives the same call-site safety for
  near-zero code.
- **SiYuan** — the best desktop reference for the FUTURE renderer↔Go-kernel
  _transport_ (spawned child on a negotiated port, one `HTTP /api/<domain>/
<action>` + one WS push, uniform `{code,msg,data}` envelope). But its
  kernel OWNS the vault (files-as-truth in Go, server-rendered block HTML) —
  copying that moves fs reads behind local HTTP and blows the 32ms/20k-file
  budget we protected by rejecting disk-over-IPC. Learn its transport, reject
  its vault ownership. Also reject its internals: the `window.siyuan`
  god-object, the `switch(cmd)` push router, one-WebSocket-per-view.

**The real work (small, mechanical):**

1. Collapse to one package `src/{main,preload,renderer,shared,types}` (0001).
2. Lift the native-seam CONTRACTS into `src/shared`: a typed IPC channel
   table (channel → {req,res}), `DataAdapter`, `ElectronGitApi`,
   `ElectronTerminalApi` — plain TS interfaces, no zod, no presenter.
3. Rewrite the architecture test (three-package → src/ directory lanes) and
   docs/architecture.md (still describes three packages + apps/server).
4. Reserve (interface only) a `KernelApi` port in `src/shared`, default-absent,
   selected at bootstrap like `DataAdapter` — the future Go kernel's seat.

**RED LINE (grilled, confirmed):** markdown / block rendering stays in the
node-privileged renderer in ALL forms (desktop and cloud). The future Go
kernel owns the AGENT backend and (in cloud) DB-as-truth — NEVER the local
vault fs, NEVER block rendering. This is the load-bearing divergence from
SiYuan and is written down as a red line, not left implicit.

**Confirmed defaults (grill):** reserve the KernelApi interface now (one cheap
file); the future Go kernel is an external spawned binary outside the pnpm/JS
build (like the old LoomSidecar, gated on a `*_BIN` env var), not a workspace
member.

**Correction to 0001:** keep the `src/{main,preload,renderer,shared,types}`
shape but drop the "DeepChat layout" framing — it is plain electron-vite
convention; the lineage is VS Code workbench → Obsidian → us.
