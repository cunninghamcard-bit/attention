# CLI deviations: native reader vs. the TS app

RFC 0001 §5.9: the socket protocol is the same; every difference in a
command's output or semantics is listed here with its reason. A difference
not listed is a defect.

| Command | TS app | Native reader | Why |
|---|---|---|---|
| all paths (`files`, `open`, `tabs`) | vault-relative: `notes/a.md` | mount-prefixed: `<mount>/notes/a.md` | the reader mounts several folders and has no vault; the mount name keeps paths unambiguous |
| `files` | complete vault index | the mounts walked with limits (200,000 files, 3 s); past a limit the command fails with an error instead of printing a partial list | the default mount is the home directory; a silent partial list would mislead an agent |
| `files` | — | skips `node_modules` and `.git`-like folders (Zed's default exclusions) | as Zed's file finder |
| `version` | `<Obsidian version> (installer <build>)` | `<reader version> (installer <reader version>)` | same shape; there is no separate installer build yet |
| `tabs` | `[<view type>] <display text>` with Obsidian view types | the same shape with the reader's view types: `markdown`, `text`, `image`, `search` | the reader's views |
| `open` | `newtab` opens a new leaf | `newtab` opens another tab in the active pane | same intent |
| `open` | the file in the active leaf (`getLeaf(false)`), a leaf already showing it revealed | the same: a tab anywhere showing it is revealed, else the active tab navigates to it | Workspace.openFile, ported |
| `open file=` | Obsidian link resolution (`getFirstLinkpathDest`) | a path with or without `.md`, then the first file whose path ends with it, without case | no metadata cache; matches the common cases |
| `help` / empty command | the TS help screen | a list of the reader's commands | the command set differs |
| `vault` | the vault's name and path | `name`: the mounts' names joined by `, `; `path`: one line per mount | several roots, no vault |
| `folders`, `folder path=/` | the vault root `/` among the folders | each mount root, as its name; `/` is not a folder | no vault root |
| `create`, `move` without a mount prefix | at the vault root | under the first mount | the first mount plays the root |
| `create template=` | the Templates plugin's | `Templates plugin is not enabled.` | no templates plugin yet |
| `move`, `rename` | rewrite the links to the file (`fileManager.renameFile`) | the file only | not yet: the index can now say which notes link to it |
| `file` | `created` is the birth time | the inode's change time | Go has no portable birth time |
| `delete` | Electron's `shell.trashItem` | the freedesktop trash (`$XDG_DATA_HOME/Trash`) on Linux; `permanent` deletes | no Electron |
| `create`, `random`, `search:open`, `tab:open`, `recents`, `workspace` | the window | need the window (`desktop`): headless says the window is closed or has no such command | headless has no workspace |
| `search`, `search:context` | over `getMarkdownFiles()`, skipping ignored files | over the project's walk (its limits), no ignore list; a matched line is cut at 400 bytes | the project's search engine |
| `commands`, `command` | palette commands that pass `checkCallback`; a failing command reports not found | every titled command; `command` runs any command with a Run and returns its error | one registry, no check callbacks |
| `tab:open`, `workspace` | every tab group (sidebars, floating) and every item's id | the center's tab groups and tabs only | the docks are the layout's |
| `links`, `backlinks`, `tags`, `outline`, … | the metadata cache, its links in code blocks counted | the index plugin; links, tags and definitions in fenced code are not counted | as Obsidian itself |
| `unresolved` | sources in insertion order | sources sorted | no insertion order to keep |
| `properties` (vault) | each property's type from the type manager | `type` is always `text` in json | no property types yet |
| `property:set` | records the type (`list` as `multitext`) in the type manager | parses by `type=` and records nothing | no property type registry |
| `property:set` without `value=` | the dispatcher refuses it (required flag) | writes `""` | no required-flag dispatcher |
| `backlinks` pane, `outline` pane | unlinked mentions; a code file's symbols | linked mentions only; headings only | not yet |
| `reload`, `workspaces`, `workspace:save`/`load`/`delete` | present | not yet | reloading the UI runtime and named layouts come later |
| `web` | replaces the active leaf's view | the same, but a tab already showing the URL is revealed; needs the window (`desktop`) | openResource, as `open` |
| any command, just after launch | registered when the app is ready | registered as its plugin loads: the socket answers before every plugin has (a script waits for `commands` to list it) | plugins load one by one |
| `bookmarks [total] [verbose] [format=json\|tsv\|csv]`, `bookmark file=\|url= [title=] [folder=]` | — (Obsidian's CLI has them; the TS app does not) | new; a bookmark is a pinned tab of the sidebar (RFC 0003 §9) and a group a pinned folder: `bookmarks` lists the pinned area as `file`, `url` and `group` items, `bookmark` pins a file or a page, in the pinned folder `folder=` names; `session.json` keeps them, and an old `bookmarks.json` is pinned once and renamed `bookmarks.json.migrated`. Folder, search and graph bookmarks and `subpath=` are gone: a pin holds a tab | no vault; the reader is the browser |
| `web:read url=`, `web:history [limit=] [format=json]`, `web:history:clear` | — | new: a page's article as markdown (headless too), the web viewer's history (`web-history.json`) | the reader's own (roadmap P3) |
| `mount path=`, `focus`, `quit` | — | new | the reader's own; `quit` stops the app as closing its window does |
| `build --with <module>[@version][=folder] [-o file] [--source dir]` | — | new, run by the binary itself, not sent to a running attention | xcaddy-style custom binary for compiled-in UI plugins (`native/examples/README.md`) |
