# R6: what ui/markdown reads of a note

RFC 0001 risk R6, P1's gate: does mygo's `ui/markdown` (v0.6.4) read the
notes attention holds, and what does the `markdown` tab type do about the
rest?

## Read as is

`parser.Default` is CommonMark with GitHub's extensions — tables, task
lists, strikethrough, autolinks — plus footnotes and math. The reader uses
it unchanged: headings, emphasis, lists, quotes, fenced code (highlighted),
tables with alignment, task lists (shown checked or not, read-only),
footnotes, `$$` math (shown as TeX: no `Math` renderer yet).

## Rewritten before the view reads it (plugins/markdownui/obsidian.go)

ui/markdown has no hook for inline syntax of its own, so the tab type
rewrites the note's text — outside fenced code and code spans — into
Markdown it does read:

| Note syntax | Becomes | Opens / shows |
|---|---|---|
| `[[name]]`, `[[name\|alias]]`, `[[name#heading]]` | a link to `attention-link:<name>` | the file the name resolves to, as the CLI's `open file=` resolves it (a path from the note's folder with or without `.md`, else the first file in the mounts whose path ends with it); the heading is not scrolled to |
| `![[pic.png]]`, `![[pic.png\|300]]` | an image `attention-embed:<name>` | the image, found by name as a link is; the width is dropped |
| `![[other note]]` | a link, as `[[other note]]` | no transclusion: the reader shows the link |
| `> [!type] title` | the quote with a bold `Type · title` first paragraph | no callout box, icon or folding (`+`/`-` ignored) |

## Not done, and where it would go

- Callout boxes and transclusion need a block of the view's own that can
  hold Markdown: ui/markdown's `Block` hook builds a block, but cannot hand
  the quote's children back to the view. A PR to mygo letting `Block`
  build the default rendering of a block's children would do it.
- Heading links (`#heading`) need the view to scroll to a heading of the
  opened note: `Nav` carries lines; the tab type would map the heading to
  its line.
- Tags (`#tag`), highlights (`==text==`) and comments (`%%…%%`) show as
  their text.
