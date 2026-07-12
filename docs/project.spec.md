spec: project
name: "project constitution"
tags: [constitution, project]
---

## Intent

Project-level invariants that every goal contract inherits. This repository
is a three-runtime workspace — a thin desktop shell, a browser-hosted
product, and a headless server — over one reconstructed local-first notes
workbench. The constitution fixes the toolchain, the fail-fast contract,
the perf budget, and the layering walls once, so individual goals never
re-litigate them.

## Constraints

### Must
- pnpm is the only package manager; a preinstall hook rejects npm and yarn.
- Fail fast on product paths: a missing configuration raises an explicit
  error naming the missing key and how to set it — never a silent fallback.
- The full vitest suite is green before any merge.
- Keep the perf budget on the 20k-file vault: openFile median under 50ms
  and explorerClick median under 120ms, measured by the PERF_VAULT harness.
- Code stays name-agnostic: no product-name literal appears anywhere in the
  tree — package names, URL scheme, env vars, titles, docs — the product
  identity lives only in the git remote.

### Must Not
- Do not add a production dependency without a goal contract that adopts it.
- Do not weaken, skip, or delete an existing test to make a gate pass.
- Do not source a default from anywhere but the user's explicit configuration.

## Decisions

- The workspace is three pnpm app packages — `@app/desktop`, `@app/web`,
  and `@app/server` — each `private: true`; the root package.json holds no
  runtime dependencies.
- Dual-track plugin architecture: `builtin/` is the internal track and may
  use internal APIs; `api/` is the community track; no internal module
  imports `api/`.
- Kernel direction rule: `vault/`, `metadata/`, and `storage/` import only
  from the kernel, `core`, `dom`, and `platform` — never upward.
- Disk access stays behind the `VaultAdapter` seam inside the web app.
- The docs household is docwright goals under
  `docs/{features,issues,architecture}` plus promoted capabilities in
  `docs/capabilities/`.
