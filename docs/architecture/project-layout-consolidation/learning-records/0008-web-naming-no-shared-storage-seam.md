# 0008 — F1 final: apps named desktop/web/server; no shared; storage stays behind the adapter seam

- **Questions closed in this round**:
  1. Rename renderer → **web**: "renderer" is Chromium process jargon
     (names where it runs); "web" names what it is — a web-technology
     app the desktop shell loads. Matches Arkloop house style
     (src/apps/web + thin desktop), already browser-runnable via
     injected fake adapter, and future-proof for a real web delivery.
  2. **No shared package today**: measured cross-runtime sharing is two
     items (SystemMenuItem type, URL_SCHEME constant); desktop imports
     them from web (shell→product direction is legal). shared/ is
     created only when a second consumer of common protocol types
     appears (e.g. server speaking the chat protocol) — same ≥2
     consumers law as library-package graduation.
  3. **File storage placement**: vault/metadata/storage live in web.
     FileSystemAdapter keeps direct node fs via the shell's
     nodeIntegration privilege; browser mode injects a fake adapter
     (the VaultAdapter seam, same design as real Obsidian's
     FileSystemAdapter/CapacitorAdapter). The VS Code-style
     disk-over-IPC purist route is explicitly OUT of scope — it would
     forfeit the just-won 20k-file perf (openFile 32ms); documented as
     a known tradeoff / possible future goal.
- **User's answer (2026-07-12)**: Confirmed the full F1 shape:
  `src/apps/{desktop, web, server}`, root as pure workspace yard,
  fixtures/e2e/examples stay at root.
