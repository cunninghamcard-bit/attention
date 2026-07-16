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
*that*. Guessing, or writing "something that looks right," is the exact
anti-pattern this project exists to avoid — verify against app.css/app.js,
never against memory or intuition.

**Reuse the small components; never fork a second protocol.** There is one
`TreeItem`, one `Setting` / `SettingGroup`, one `Notice`, one `Modal`, one
icon registry, one token layer. A new view *composes* these; it does not
hand-roll its own row / button / notice / dropdown. Reinventing a primitive,
or standing up an "our own" CSS / notice / settings system next to the
faithful one, breaks the architecture and is not allowed. If a primitive is
missing a capability, extend the shared primitive — do not clone it.

**The stylesheet layering is the boundary, and it is load-bearing.**
Everything under `styles/{tokens,base,components,features,workspace,editor}`
is a *faithful extract* of app.css and must stay byte-identical to it. Our
own additions and overrides live **only** in `styles/product/**`, imported
last. Never put a product choice in a faithful file; never let a faithful
file drift from app.css. (Guarded by `StyleSystem.test.ts` and a
property-level diff against app.css.)

**Semantics drive structure, not behavior.** An element's classes are decided
by *what it is* — a file wears `nav-file` / `nav-file-title`, a folder or
container wears `nav-folder` — never by *what it can do* (collapsible is not
the same as folder). Get this wrong and themes render the element as the wrong
thing (a file painted as a folder), because themes key off these exact class
names.
