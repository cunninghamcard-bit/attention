# 0011 — Centralize tests (DeepChat style); harden every gate blind spot

- **Trigger**: root-residue breakage (examples/ imports died silently)
  exposed that the gates never covered root-level siblings of src/.
  A three-reader study of DeepChat + our own blind-spot audit followed.
- **Evidence taught**: DeepChat centralizes 498 tests under test/
  (0 colocated) with mirror paths — but also excludes scripts/test/docs
  from lint+format and does NOT gate the full unit suite on PRs (the
  lesson cuts both ways). Our audit: src/apps/server had zero
  typecheck/tests/build-in-gate; root configs, e2e/, scripts/ were
  typechecked by nothing; `pnpm run e2e` double-ran desktop specs;
  lint's arg was literally `src`.
- **Recommendation**: keep tests colocated (move-immunity was just
  proven by the refactor); harden gates.
- **User's answer (2026-07-12)**: CENTRALIZE ("集中吧") — informed
  override after the tradeoffs (mirror-tree upkeep tax, one-time
  migration) were taught. Plus "全上" on the whole hardening list.
- **Consequences**:
  1. All unit tests move to tests/{web,desktop}/** mirroring source
     paths; imports go through new aliases @web/* and @desktop/*;
     tests/architecture.test.ts already lives there. e2e/ stays a root
     roof of its own (already centralized; moving it would churn the
     contract/constitution/memory texts that cite the perf command).
  2. Gate hardening: server tsconfig + typecheck:server; build:server
     joins check; lint sweeps src tests e2e scripts; tsconfig.tools.json
     typechecks root configs + e2e + scripts + examples; playwright
     main config ignores desktop specs; mise.toml pins node+pnpm;
     docwright install-hooks; PublicApi surface-freeze alarm test.
