## Architecture: reconstruct Obsidian, do not invent a parallel system

This project is a faithful reconstruction of Obsidian. Its cross-cutting
systems — the CSS/cascade system, the layout and typography system, the
notice/error system, the settings surface, the icon system, and every other
protocol — must **reproduce Obsidian's**, not stand up a second independent
one beside it. This is the single most important rule in the repo.

**Read the source; do not write your own.** Obsidian's shipped code is ground
truth, and it is checked in:

- `decode-obsidian/ref/obsidian/app.css` — CSS, layout, typography, the
  cascade. A class name or rule there IS the spec; match it byte-for-byte.
- `decode-obsidian/ref/obsidian/app.js` — DOM structure, component behavior,
  the protocols (notices, modals, settings, events, icons).

Before writing a rule or a component, find how Obsidian does it and port
_that_. Guessing, or writing "something that looks right," is the exact
anti-pattern this project exists to avoid — verify against app.css/app.js,
never against memory or intuition.

**Reuse the small components; never fork a second protocol.** There is one
`TreeItem`, one `Setting` / `SettingGroup`, one `Notice`, one `Modal`, one
icon registry, one token layer. A new view _composes_ these; it does not
hand-roll its own row / button / notice / dropdown. Reinventing a primitive,
or standing up an "our own" CSS / notice / settings system next to the
faithful one, breaks the architecture and is not allowed. If a primitive is
missing a capability, extend the shared primitive — do not clone it.

**The stylesheet layering is the boundary, and it is load-bearing.**
Everything under `styles/{tokens,base,components,features,workspace,editor}`
is a _faithful extract_ of app.css and must stay byte-identical to it. Our
own CSS lives WITH its component (`builtin/<slice>/`, `views/`, `app/`),
imported by `styles/index.css` after every faithful layer, and behaves like
a well-mannered community plugin: selectors stay in the component's own
namespace — faithful classes appear only as ancestor context or under an
own attribute qualifier — and faithful design tokens are consumed or
locally parameterized, never redefined globally. There is NO override
layer: `styles/product/` is frozen at three recorded exceptions pending
the deviations ticket. Never put a product choice in a faithful file;
never let a faithful file drift from app.css. (Guarded by
`StyleSystem.test.ts`: the exactly-once manifest, own-last order, and the
restyle/token walls.)

**Semantics drive structure, not behavior.** An element's classes are decided
by _what it is_ — a file wears `nav-file` / `nav-file-title`, a folder or
container wears `nav-folder` — never by _what it can do_ (collapsible is not
the same as folder). Get this wrong and themes render the element as the wrong
thing (a file painted as a folder), because themes key off these exact class
names.

## Collaboration: sandboxed writes, committed handoffs

Multiple agents work this repo. Two rules keep them from destroying each
other's work — both were paid for with real accidents:

**Write in a sandbox, land as a commit.** No agent edits a shared worktree
directly. Do the work in your own isolated copy (a boxsh COW sandbox —
`--bind cow:<repo>:<dst>` — or a detached git worktree), then land it as a
COMPLETE commit on the branch. Uncommitted WIP must never sit in a tree
another agent can touch: every collision we have had was ignited by exactly
that. Finish → commit → hand off; never leave state behind.

**One branch, one committer.** Each branch has a single owner who lands
commits on it. Everyone else is read-only there: contribute by handing the
owner a committed hash to adopt (git show/log/diff to audit), never by
pushing your own commits into someone else's branch. Before any commit in a
shared tree, run `git branch --show-current` and make sure you are where
you think you are.

Verification runs before every handoff: the full gate green in YOUR sandbox
on YOUR hash, receipts included. A green you borrowed from another tree or
an earlier HEAD is not a green.
