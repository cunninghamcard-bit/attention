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
| most commands (`read`, `create`, `tags`, `backlinks`, …) | present | not yet | the reader is P0b/P1; see docs/roadmap.md |
| `mount path=`, `focus`, `quit` | — | new | the reader's own; `quit` stops the app as closing its window does |
