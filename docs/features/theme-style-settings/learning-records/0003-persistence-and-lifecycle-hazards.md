---
record: 0003
goal: theme style settings
round: persistence and lifecycle
status: confirmed
---

# Persistence: the repo's config store will betray a naive implementation

Decision (user): values persist in a dedicated `.obsidian/style-settings.json`
via `Vault.writeConfigJson` (`src/renderer/vault/Vault.ts:456`), namespaced by
the declaring block's `id` so switching themes does not lose values.
`readConfigJson` (`:452`) is the read side.

The reference implementation to copy is **`MetadataTypeManager`**
(`src/renderer/views/properties/MetadataTypeManager.ts`), the one builtin that
already owns a config json. Three hazards it exists to survive:

## 1. Writes echo back into your own listener

`JsonStore.write` fires `trigger("raw", path)` after **every** write
(`src/renderer/storage/JsonStore.ts:115-119`), and `App.ts:239` forwards
jsonStore `raw` → vault `raw`. So `writeConfigJson` synchronously re-enters your
own `raw` handler. Without a guard, every save triggers a reload — clobbering
in-flight edits or looping.

The guard (`MetadataTypeManager.ts:61-70`, `:138-143`): stamp
`const mtime = Date.now(); this.lastSave = mtime;` and pass `{ mtime }` to
`writeConfigJson`; on `raw`, `stat()` the file and reload **only if
`this.lastSave < mtime`** — i.e. only when someone else wrote it.

## 2. Write failures are swallowed

`Vault.writeJson` (`:487-497`) wraps the write in `try { … } catch {}` — the
comment says Obsidian's own `writeJson` swallows failures at this layer. The
promise **resolves even when the write failed**. Do not build a "saved"
affordance on it resolving.

## 3. `readJson` is tri-state, and `?? DEFAULTS` destroys data

`readJson` (`:468-479`) returns `null` for *not found* but `undefined` for a
*parse or IO error*. Collapsing both with `?? DEFAULTS` turns "your settings
file is corrupt but recoverable" into "you have no settings" — and because the
save path writes the whole document from memory, the next save then
**overwrites the recoverable file with defaults**, permanently destroying 500+
user settings. The two cases must be distinguished before any write.

# Lifecycle: `css-change` is a firehose, and the payload is untyped

`CustomCss.setThemeCss` fires `workspace.trigger("css-change", id)`
(`src/renderer/app/theme/CustomCss.ts:180`) — but the same event name is emitted
with many different ids: `"translucency"` (`:110`), arbitrary `registerCss` ids
(`:147`, `:155`), `plugin:${id}` (`:165`), `snippet:${id}` (`:195`), and
`"base-theme"` / `"accent-color"` / `"font-family"` / `"font-size"` from
`AppearanceManager`. Re-parsing the theme on every one of these is a perf trap.

Three further sharp edges:

- **The typed overload drops the payload.** `Workspace.ts:226` declares
  `on(name: "css-change", callback: () => any, …)` — no parameter. The id is
  passed at runtime but invisible to TypeScript.
- **No event fires on a no-op switch.** `setThemeCss` only triggers when the
  text actually changed (`:176-182`), and `setTheme("")` bypasses the debounce.
- **`getActiveTheme()` returns `null` on the disk-fallback path.**
  `ThemeManager.applyThemeFromVault` (`:51-58`) reads the theme CSS straight off
  disk and never calls `registerTheme`, so the registry lookup in
  `getActiveTheme()` (`:85-87`) finds nothing. Any code reading
  `getActiveTheme()?.cssText` to find the active theme's source will silently
  see no theme in exactly the case where a theme *is* active.

## Decision

Own the theme text explicitly rather than trusting `getActiveTheme()`: read it
from the same place `CustomCss` does, and rebuild on `css-change` only when the
active theme's id or text actually changed. Copy `MetadataTypeManager`'s
mtime echo-guard verbatim, and branch on `null` vs `undefined` when loading.
