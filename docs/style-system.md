# ArkLoop style system

`src/styles/index.css` is the single stylesheet entry point. Its import order
**is** the cascade: many selectors across layers share specificity, so a file
that is imported later wins. Do not reorder imports casually —
`src/styles/StyleSystem.test.ts` guards the order shape, full coverage and the
design-token contract.

## Layers

| Layer | Owns | Examples |
| ----- | ---- | -------- |
| `tokens/` | Design tokens — the only place colors, spacing, typography and radii are defined | `--background-primary`, `--code-keyword`, `--size-4-2` |
| `base/` | Reset, RTL, platform (mobile) | element defaults |
| `vendor/` | Vendored third-party styles | pdf.js |
| `components/` | Generic UI components, business-free | button, menu, modal, tree-item, suggestion |
| `workspace/` | The app shell | ribbon, side docks, tabs, titlebar, status bar, empty state |
| `editor/` | Editing surfaces | CM6, source/reading views, syntax highlight, callouts |
| `features/` | Feature panes | search, explorer nav, outline, graph, webviewer |
| `product/` | ArkLoop additions and overrides — **always imported last** | code view, terminal, file-type icons, symbol outline |

New rules go into the layer that matches *what the thing is*. Overrides of
upstream rules belong in `product/` where late import order guarantees the win.

## History and the fidelity contract

Everything outside `product/` originates from the vendored Obsidian `app.css`
artifact, split during the clean-room study phase. The byte-identity lock
(`app-split.test.ts`, retired) served that phase; since the ArkLoop refit the
CSS is **owned and forked**. What we still preserve — deliberately — is the
*names* layer of the old contract, because installed themes and community
plugins target it:

- **Design tokens**: the `--*` variables in `tokens/tokens.css`.
  `StyleSystem.test.ts` pins the critical set.
- **Class names**: core layout classes (`.workspace-*`, `.nav-*`,
  `.tree-item-*`, `.suggestion-*`, …) stay stable.

Runtime-injected CSS (themes, snippets, `CustomCss`) loads after the bundled
stylesheet and therefore overrides every layer, including `product/`. That is
by design: the user's theme always wins.

## Quarantine

`src/theme/obsidian-structure.css` and `src/theme/reconstruction/` are
study-era stylesheets kept out of the default import chain;
`src/theme/CssContract.test.ts` enforces that they stay out and never redefine
core layout selectors.

## Future work (deliberate, not yet)

- Split `tokens/tokens.css` into `core` / `light` / `dark` files (content
  split, needs its own verification pass).
- Adopt CSS `@layer` to make the cascade explicit instead of order-implied.
  This *changes* conflict resolution (layer beats specificity) and must be
  done with visual regression coverage, not as a mechanical move.
