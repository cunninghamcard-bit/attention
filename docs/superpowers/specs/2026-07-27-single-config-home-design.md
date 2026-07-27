# One config home, zero writes into opened folders

Date: 2026-07-27
Status: approved, not implemented

## Problem

Opening a folder writes `.obsidian/` into it — `app.json`, `appearance.json`,
`core-plugins.json`, `workspace.json`, `plugins/`, `themes/`. That is Obsidian's
model and it is right for a notes vault: the vault carries its own
configuration. It is wrong for a code repository, where the app's settings show
up as untracked files in the user's git status. Measured on
`~/Projects/twilight-ai`: six untracked entries, visible in the app's own review
view.

## Decision

The config directory stops being per-folder and becomes per-app. One
`.obsidian/`, always at the same path:

```
~/Library/Application Support/attention/   (Electron userData)
  obsidian.json          known-folder registry — already lives here
  .obsidian/
    app.json  appearance.json  core-plugins.json  workspace.json
    plugins/  themes/
```

The directory's name, layout and file formats do not change. Only its location
does. An opened folder is a working directory and nothing is ever written into
it.

This is a deliberate deviation from Obsidian, at the level of where state
lives. It is recorded here rather than in `styles/deviations/` because it is not
a style choice.

## What this costs

Per-folder configuration differences are gone. One theme, one set of enabled
plugins, one appearance for the whole app — the VS Code model. Accepted.

Existing `.obsidian/` directories inside folders are ignored: not read, not
imported, not deleted. Whatever is on disk stays there for the user to remove.

## Implementation

The seam is one injection. `bootstrap.ts:135` currently hands the JsonStore the
*vault's* `FileSystemAdapter`:

```ts
provideJsonStoreAdapter(adapter ? new FileSystemJsonStoreAdapter(adapter) : undefined);
```

It gets an adapter rooted at the config home instead. `JsonStore`'s
`root = ".obsidian"` (`JsonStore.ts:106`) is unchanged, so everything beneath it
— including `PluginInstaller`/`PluginLoader`, whose `pluginRoot = "plugins"` is
relative to the same root — follows without edits. `provideAppAdapter(vault)`
stays as it is: content and config are simply two different roots from here on.

Added: one field. Main answers `sendSync("vault")` with `{ path, home }` instead
of `{ path }` (`bootstrap.ts:145`).

Removed:

- The `configDir` hot-reload branch at `App.ts:587`. It watches the vault for
  writes to `${configDir}/app.json` and friends; with config out of the vault it
  can never fire. Deleted, not rewired to watch the home directory — editing
  config files by hand and expecting a live reload is not a capability worth
  carrying.
- Per-folder workspace layout. `workspace.json` stays a single file. Switching
  folders keeps one layout; tabs pointing at files that no longer exist fail to
  restore, which is acceptable. Add per-folder layouts when someone wants them.
- Any import or migration path for existing `.obsidian/` directories.

Browser mode is unaffected: with no home path the JsonStore stays memory-only,
exactly as it does today with no vault.

## Test

The goal stated as an assertion, and it is the one that matters:

> open a folder → boot → change a setting → the folder's file list is byte-identical

Anything that writes into an opened folder fails this directly. Beyond it, the
existing config tests keep passing against the new root; the ones that assert
`.obsidian/...` paths inside a vault need their base changed, not their meaning.

## Not in scope

Deleting the starter screen and reworking how folders are opened and switched.
That work depends on this one — opening an arbitrary folder should stop being a
hostile act before it is made easy — and gets its own design.
