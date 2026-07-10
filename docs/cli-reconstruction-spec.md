# CLI reconstruction spec

Faithful reconstruction of Obsidian's command-line interface. Every
mechanism here is reverse-engineered from `decode-obsidian/ref/obsidian`
(`main.js` for the transport, `app.js` for the semantics), not guessed.
Character offsets cite the decompiled source so any claim can be re-checked.

**Scope:** copy the layering, not every command. Reproduce the socket
machine, the `Cli` registry, and the `registerCliHandler` lifecycle. Do
**not** invent a public parser service, an exit-code policy, a socket-perm
policy, or a TUI. Product vocabulary: the binary and socket are `arkloop`,
not `obsidian`.

---

## 1. The core principle

The CLI is **not a second application API**. It is the existing plugin
extension system projected onto the terminal. One core registry (`App.cli`)
holds every command; the core app, internal plugins, and community plugins
all register through the same door:

```
App.cli                       one core Command Registry (handlers: Map)
  core bootstrap              -> app.cli.registerHandler(...)
  InternalPlugin              -> this.registerCliHandler(...)   (no name prefix)
  Community Plugin            -> this.registerCliHandler(...)   ([name]: prefix)
  Chat / Agent Plugin         -> this.registerCliHandler("agent:threads", ...)
```

Consequences that fall out for free (all source-backed, §4):

- plugin loads → its commands appear immediately, in `help` and completions;
- plugin unloads → Component lifecycle auto-unregisters them;
- duplicate id → the registry throws, never a silent overwrite;
- the transport layer (Electron main) never learns one business concept.

This is exactly the shape our Chat/Agent product wants: `arkloop agent:threads`
is registered by the chat plugin, not special-cased in the shell.

---

## 2. Layering (verified by the source's symbol split)

The decompiled `main.js` and `app.js` divide the work cleanly, and the
reconstruction preserves the seam:

| Concern | Process | Reconstructed location |
|---|---|---|
| Unix socket / Windows named pipe, header framing | main | `electron/cli/CliServer.ts` |
| Second-instance → client (connect, pipe, exit code) | main | `electron/cli/CliClient.ts` |
| `vault=` / cwd / most-recent vault routing | main | `electron/cli/CliVaultRouter.ts` |
| Deliver `argv` to the renderer (loaded / queued) | main | `VaultWindowManager.executeCliRequest` |
| `window.handleCli` + `window.cliQueue` | renderer | `src/cli/Cli.ts` (`init`) |
| Parsing, dispatch, unknown-command, fuzzy, validation | renderer | `src/cli/Cli.ts` |
| Command semantics | renderer | core bootstrap + plugins |
| `registerCliHandler` lifecycle | renderer | `Plugin` / `InternalPlugin` base |

**Proof of the seam:** the string `"…not found. It may require a plugin to be
enabled."` appears once in `app.js` and zero times in `main.js`. Unknown-command
resolution lives entirely in the renderer registry; main only wraps a rejected
`executeJavaScript` promise as `Error: <string>`.

---

## 3. The `Cli` registry (renderer) — DONE (step 1)

Reconstructed from the `CA` class at `app.js` ~1453465. Implemented in
`src/cli/Cli.ts`, 18 unit tests.

```ts
class Cli {
  handlers: Map<string, CliCommand>;
  registerHandler(id, description, flags, handler): void;   // throws on dup
  unregisterHandler(id, handler?): void;                    // removes only if handler still owns the slot
  handleCli(argv): Promise<string>;                         // installed as window.handleCli
  init(app): void;                                          // installs global + drains cliQueue + registers builtins
  formatTable(columns, rows, format): string;               // TODO: table helper (json/tsv/csv), §7
}
```

### `handleCli(argv)` — the dispatch pipeline (all faithful, tested)

1. `argv[0]` empty or `--help` → `help`.
2. Parse `argv[1:]`: `key=value` → value; bare token → the **string** `"true"`.
3. **Colon fallback**: `daily:read` with no exact handler → split on the last
   `:`; if parent `daily` declares a `read` flag, dispatch `daily` with
   `read="true"`.
4. Unknown id → fuzzy suggest (`wA`: prefix `0` > substring `1` > Levenshtein
   ≤3 `2+d`, else drop; best-first, top 3). `Command "x" not found.` + either
   ` Did you mean: …?` or ` It may require a plugin to be enabled.` — **thrown
   as a plain string** (main adds the `Error: ` prefix).
5. **Format shorthand**: a `format` flag with `value:"json|tsv|csv"` +
   `files json` (or `--json`) → `format=json`, shorthand key deleted.
6. **Required validation**: any `required` flag absent →
   `Missing required parameter: <name>\nUsage: <cmd> <usage>` (thrown string;
   usage formats required as `name=value`, optional as `[name=value]`).
7. **`--copy`** is a central framework flag: captured, deleted, and after the
   handler runs, a non-empty result is mirrored to `navigator.clipboard`.
8. Run `handler(params)`; a `void` return writes nothing back (main's
   `u && p(u)` skips falsy).

### `help` (builtin)

Sorted by id; skips `__*` internals; splits `dev:*`/`devtools`/`eval` into a
Developer group. `help <cmd>` shows that command and its `<cmd>:*` family, or a
"No commands matching" fuzzy hint. Header re-vocabularied to `Arkloop CLI` /
`Usage: arkloop <command> [options]`.

### Not reconstructed (no TUI)

The `__completions` / `__commands` / `__files` internals feed the interactive
completion REPL only; skipped. The socket protocol reserves `tty:true` for that
future branch — nothing here changes to add it later.

---

## 4. Plugin extension API — the projection

Both base classes wrap the core registry identically; the only difference is
the community-name prefix.

**Community `Plugin.registerCliHandler`** (`app.js` ~2741984, verbatim):

```js
registerCliHandler(e, t, n, i) {
  this.app.cli.registerHandler(e, "[" + this.manifest.name + "]: " + t, n, i);
  this.register(() => this.app.cli.unregisterHandler(e, i));
}
```

**`InternalPlugin.registerCliHandler`** (`app.js` ~2763737, verbatim) — same,
without the name prefix:

```js
registerCliHandler(e, t, n, i) {
  this.app.cli.registerHandler(e, t, n, i);
  this.register(() => this.app.cli.unregisterHandler(e, i));
}
```

`this.register(cleanup)` is the Component lifecycle already in our codebase, so
unload → unregister is automatic. `unregisterHandler(id, handler)` removes only
when `handler` still owns the slot, so a peer re-registration is never
clobbered by a late unload.

The internal-plugin id list (`app.js` ~2763860) is
`["file-explorer","global-search","switcher","graph","backlink",
"outgoing-link","tag-pane","page-preview","daily-notes", …]` — these register
their own commands (e.g. `daily-notes` → `daily`, `daily:read`, …), they are
not core builtins.

---

## 5. The socket machine (main) — steps 2–5

Reconstructed from `main.js`: server `Ve=createServer` (~42916), dispatch `et`
(~42760), `executeCliRequest` `Xe` (~42874), and the second-instance client.

### Server (`CliServer.ts`)
- listen on `~/.arkloop-cli.sock`; **`unlinkSync` the stale socket before
  listen unless Windows** (named pipes need no unlink).
- per connection: `setNoDelay(true)`; read to the first `\n`; parse the header
  `{argv, tty, cwd}`; **`unshift` the remaining bytes** back onto the socket
  (reserved for tty stdin); `console.log` the header; `await et(...)`.

### Dispatch (`et`)
1. non-tty + empty argv → `pe()` **opens the Starter window** (800×650,
   `starter.html`) and does **not** return — flow continues.
2. last arg starts `obsidian://` → handle as a URL, not a command.
3. `C.cli` **enable gate ①** → `"Command line interface is not enabled. Please
   turn it on in Settings > General > Advanced."`
4. vault routing (`CliVaultRouter`): `vault=<name>` → id; else the vault
   containing `cwd`; else the most-recent vault.
5. not (tty && empty) → one-shot `Xe(vaultId, argv)`; write result (with a
   trailing `\n` if missing); `end`.
6. tty && empty → interactive REPL (`ut`) — **not reconstructed**.

### `executeCliRequest` (`Xe` / `VaultWindowManager.executeCliRequest`)
- `C.cli` **enable gate ②** — same string (defensive; `Xe` is reachable from
  other main paths).
- vault-exists check → `"Vault not found."`.
- window loaded → `webContents.executeJavaScript` of:
  ```js
  new Promise((resolve, reject) => {
    let argv = <JSON>;
    if (window.handleCli) Promise.resolve(window.handleCli(argv)).then(resolve, reject);
    else { window.cliQueue = window.cliQueue || []; window.cliQueue.push({ argv, resolve, reject }); }
  })
  ```
- window not yet loaded → the existing `deliverAction()` pattern: wait for
  `did-finish-load`, then run the same script. `window.cliQueue` drains when
  `Cli.init` runs (bootstrap, after `new App`).
- a rejected promise → `catch(d) { return typeof d === "string" ? "Error: " + d : String(d) }`.

### Client (`CliClient.ts`, second-instance branch)
The same binary, relaunched, fails `requestSingleInstanceLock()` — **that
failure is the "become a client" signal**. Connect the socket, send
`{argv, tty, cwd}\n`, pipe stdin↔socket and socket→stdout; `exit(0)` on socket
end (even when the response is an error string), `exit(1)` on socket error.
This replaces `main.ts`'s current `app.quit()` in the no-lock branch.

---

## 6. Implementation order — status

1. ~~`Cli` registry + `handleCli` + parser + help.~~ **DONE** (`src/cli/Cli.ts`).
2. ~~`registerCliHandler` lifecycle + `executeCliRequest` + `window.cliQueue`.~~
   **DONE** — the plugin lifecycle already existed (`Plugin` /
   `InternalPluginWrapper`) and was reconciled onto the one faithful registry;
   `App.cli.init(this)` installs `window.handleCli` from the App constructor.
3. ~~Unix socket server/client; one real `arkloop vault`.~~ **DONE** — proven
   live (primary app + second-instance CLI over `~/.arkloop-cli.sock`):
   `vault`, `files`, `read`, `commands`, unknown-command fuzzy all correct.
4. ~~`main.ts` second-instance → CLI client.~~ **DONE**.
5. `cliEnabled` gate — **DONE** (`settings.cli`, off by default, live-verified
   both ways). **Remaining (untestable on this macOS box):** the Settings >
   General > Advanced toggle UI (renderer); the Windows named-pipe
   second-instance flow (the reference has the primary initiate the pipe
   client — `defaultCliSocketPath` returns the pipe path, but that handshake
   is unbuilt); the packaged `arkloop` launcher/symlink.
6. E2E — **DONE manually** (steps 3/5 above). An automated desktop e2e
   (spawn primary + secondary electron) is not yet scripted; the seam is
   covered by the CliServer/CliDispatch/registerCliCommands unit tests.

### Review round 3 — URL scheme end to end (applied)

Round 2 registered `arkloop://` at the OS but left the whole URL chain on
`obsidian://` — a dangerous half-change: `arkloop://` launches parsed to
nothing, and "Copy link" still emitted `obsidian://open?…`, which opens the
user's real Obsidian. Fixed with one source of truth: `src/protocol/scheme.ts`
exports `URL_SCHEME = "arkloop://"`, imported by the renderer URI router, the
Electron URL parser + argv extractor, the CLI URL short-circuit, and every
generated share link (`App.getFileUrl`, plugin-share clipboard). The plugin
API keeps its faithful name `registerObsidianProtocolHandler`; only the scheme
string changed. Verified live: `arkloop arkloop://open?file=X` → "Processed URI
…"; `arkloop obsidian://open?…` is now just an unknown command (no real
Obsidian touched).

### Review round 2 — identity separation (applied)

We reconstruct Obsidian's CLI **inside our own app**; we must never drive,
open, or write real Obsidian's data. Three collisions were removed:

- **userData**: `app.setName("Arkloop")` before the first
  `getPath("userData")`, so state lands in `.../Arkloop`, not the generic
  Electron dir.
- **default vault**: `Documents/Arkloop Vault` (env override
  `ARKLOOP_VAULT_PATH`), never `Documents/Obsidian Vault` — the user's real
  Obsidian data. (This is why an earlier e2e routed into the real vault:
  the default path was copied verbatim from the reference.)
- **protocol scheme**: register `arkloop://`, not `obsidian://` (registering
  the latter hijacks the real app's OS-level links). obsidian:// URLs
  arriving via the CLI are still parsed internally.

Verified hermetic: `arkloop vault` returns our temp vault, our userData is a
separate `Arkloop/` dir, and the real `Obsidian Vault` mtime is unchanged.

### Review round 1 — five fidelity corrections (applied)

1. `cliQueue` drains on `workspace.onLayoutReady`, and the queue is set to
   `null` after (was: drained immediately in `init`, breaking the real
   "nothing runs against a half-built workspace" boundary).
2. Gate ② restored: `executeCliRequest` re-checks `C.cli` independently of
   `et`'s gate (real `Xe` gates too — it is reachable from other main paths).
3. Socket path platform contract: macOS `~/.arkloop-cli.sock`; Linux
   `$XDG_RUNTIME_DIR/.arkloop-cli.sock` falling back to home; Windows
   `\\.\pipe\arkloop-cli-<username>`.
4. Help flag lines render `name=value` and append `(required)`.
5. The server no longer wraps a rejected exec as `Error: …` — the only
   faithful wrap lives where `Xe` catches the renderer rejection
   (`executeCliRequest`); the server logs and drops the connection.

### Batch coverage

**Batch 2 (2026-07-11, workflow: 9 lanes × extract→implement→fidelity-verify).**
39 commands wired onto real services, each reverse-engineered verbatim from the
`registerHandler`/`registerCliHandler` call-sites (byte offsets recorded per lane):

- **Core registry** (`registerCliCommands` → `src/cli/commands/`):
  - file writes: `create` (content/template/overwrite/open), `append`, `prepend`,
    `move`, `rename`, `delete` — vault.create/append/process/delete/trash,
    fileManager.renameFile/createNewFile.
  - metadata: `tags`, `tag`, `properties`, `property:read/set/remove`, `aliases` —
    metadataCache.getTags() (added: verbatim port with nested-tag rollup,
    case-insensitive merge, isUserIgnored skip), getFileCache, processFrontMatter.
  - graph lists: `backlinks`, `unresolved`, `orphans`, `deadends` —
    metadataCache.resolvedLinks/unresolvedLinks.
  - navigation: `random`, `random:read`, `reload`, `tabs`, `recents`, `tab:open`,
    `workspace` — vault.getMarkdownFiles, workspace tree/recentFileTracker.
  - misc: `version` (Platform.version/build ← `version` sync IPC; dev shows the
    Electron version, packaged shows the app version), `vaults` (`vault-list`
    sync IPC), `folder`, `file`.
- **Internal plugins** (via `plugin.registerCliHandler` in each definition's init):
  - global-search → `search`, `search:context`, `search:open` (SearchEngine,
    reordered to vault traversal order + filename-word bare hits per real BH).
  - outline → `outline`; outgoing-link → `links` (default-off seam here, so
    `links` surfaces only when that plugin is enabled — the faithful carrier contract).
  - word-count → `wordcount` (countWords now uses the verbatim Aee regex port).
  - webviewer → `web` (default-off; WebViewerView is now `navigation=true` like real).
  - workspaces → `workspaces`, `workspace:save/load/delete` (controller now
    persists `{workspaces, active}` like the real plugin).
- **Shared prototype methods hoisted to `Cli`** (their real home):
  `tryResolveFile(params, allowActiveFallback)` (four verbatim thrown strings),
  `formatTable(header, rows, format)` (json/tsv/csv, no header row),
  `formatAsciiTree` / `formatAsciiTreeWithRoot`, exported `alphaCompare` (real `ub`).
  Batch-1 `read`/`open` refit onto them (`open` has NO active-file fallback and
  echoes `Opened: <path>`; `read` uses cachedRead).

Skipped with reasons: `restart` (renderer has no relaunch IPC surface — no fake
handler). Excluded by ruling: `daily*`, `bookmark*`, `template*`/`templates`,
`task*`, `base*`, plus `history*`, `sync*`, `publish*`, `unique` — unregistered,
so they produce the real unknown-command error.

Known dev-only divergence: unpackaged `version` reports Electron's version
(`app.getVersion()` without a packaged app version). Disclosed divergences are
commented at their sites (e.g. template `{{date}}` uses our formatDate subset).

---

## 7. Command surface — register only real services

`app.js` has **75 `registerHandler` call-sites** = the full real surface. We do
not reproduce them for a count. The rule (matches the project's fail-fast
stance): a command is registered **only when the service behind it actually
works** in this reconstruction. No empty handlers, no fake results.

First batch, backed by services that exist today, registered by core bootstrap
or the relevant internal plugin:

```
help, version                    (Cli builtins / core)
vault, vaults, files, folders    (core)
read, create, append, prepend, move, rename, delete   (core, vault ops)
search, tags, links, outline     (core / metadata)
open, tabs, workspace            (core / workspace)
command                          (core, executeCommandById)
plugins / themes / snippets      (only when their registry is real)
```

Not registered — return nothing, not a fake result:

```
Graph, Sync, Bases, and any command whose service is absent.
```

`formatTable(columns, rows, format)` (registry helper, `app.js` ~1453674) lands
when the first table-outputting command needs it (`json|tsv|csv`); adding it
now would be speculative.

The per-command attribution (which of the 75 is core vs which internal plugin,
and which map to a live service in `src/`) is discovered per command during
steps 5–6, not front-loaded here — the spec fixes the *framework*, the commands
fill in against real services as they land.

---

## 8. Non-goals

- No public `CliParser` service. Parsing is private to `Cli`; plugins depend on
  `registerCliHandler`, not a parser.
- No exit-code policy beyond the faithful `exit(0)` on end / `exit(1)` on socket
  error.
- No socket-permission policy beyond what real Obsidian does.
- No TUI: no raw stdin, history, Tab completion, search mode, or interactive
  `vault:open`. The `tty:true` protocol branch is reserved, not built.
