---
record: 0001
goal: theme style settings
round: variable-tier override carrier
status: confirmed
---

# The variable tier must write inline custom properties on `<body>`

## What was asked

Where does a Style Settings implementation put the CSS custom properties it
generates, so that they reliably beat the theme that declared the defaults?

## What the evidence says

A cascade experiment was run in a real browser against the repo's actual
stylesheet, reproducing the true `<head>` order (app `index.css` → the
`registerCss` slot → the theme `<style>` → the snippet slot), with
`.theme-dark` on `<body>`. Each candidate carrier was applied in isolation and
read back with `getComputedStyle`.

| carrier | wins? |
| --- | --- |
| `:root { --x }` in a `<style>` appended last in head | **no** |
| `.theme-dark { --x }` appended last in head | only against light theme selectors |
| the same rule in the `registerCss` slot | **no** — that slot is inserted *before* the theme |
| `document.documentElement.style.setProperty` | **no** |
| `document.body.style.setProperty` | **yes, unconditionally** |

`:root` is not merely weak here — it is structurally dead. Custom properties
**inherit**, and every variable in this app is declared on `<body>`:
`src/renderer/styles/tokens/tokens.css:23` opens a `body { … }` block, and the
theme-class blocks are `.theme-light` / `.theme-dark` (tokens.css:864, :869,
:916), which also match `<body>`. Community themes do the same. A declaration
on the element itself always beats a value inherited from its parent, so no
amount of source order, added specificity, or `!important` on an
`:root`/`<html>` declaration can win against a `--var` declared on `<body>`.

An inline style attribute is author-origin at the highest priority for the
element it sits on, so `body.style.setProperty()` beats every author selector
that could match `<body>` — including a theme using `body.theme-dark.mod-macos`
or `!important` (for the latter, pass the `"important"` priority).

## Why it also settles popouts

`src/renderer/app/BodyClasses.ts:50-82` installs a `MutationObserver` with
`attributeFilter: ["class", "style"]` on the main body and copies
`style.cssText` wholesale into each popout body. Custom properties serialize
into `cssText`, so inline body properties reach popout windows **for free**.
Nothing in the codebase copies `<style>` elements into a popout document
(popouts are `about:blank` + `<base>` and today carry no stylesheets at all),
so a `<style>`-based tier would not reach them by any route.

## Decision

The variable tier writes each resolved value with
`document.body.style.setProperty(name, value)`. No generated `<style>` element,
no `:root` block.

## Why this matters

Every "obvious" design — inject a `<style>` with `:root { … }` — is wrong here,
and wrong in a way that only shows up against a real theme. Reasoning about
specificity alone would have produced a broken implementation that passes a
naive unit test.
