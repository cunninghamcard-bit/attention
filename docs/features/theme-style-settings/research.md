---
artifact: research
goal: "theme style settings"
derived_into: spec.md
---

# theme style settings — Research

> Follow every claim back to the source that owns it. Primary sources
> first; never trust parametric knowledge.

Three research rounds ran against primary sources: the shipping Primary theme
(`.obsidian/themes/Primary/theme.css`), Obsidian itself
(`decode-obsidian/ref/obsidian/app.js`, `app.css`), the renderer source, and a
live cascade experiment in a browser. The Style Settings plugin is **not on
this machine** — no semantic below is recalled from memory; each is derived
from evidence or explicitly marked unknown.

## Unknowns

- What exactly is the `@settings` block's schema, and what body class / CSS
  variable does each setting type produce? → F1, F2
- Where must a generated CSS custom property live to beat the theme that
  declared the default? → F3
- Where do values persist, and what will the repo's config store do to a naive
  implementation? → F4
- What does "align with Obsidian's settings architecture" actually mean for a
  517-item, 69-heading, 4-level, searchable surface? → F5
- Can Obsidian's colour control carry the 259 colours that have an alpha
  channel? → F6

## Industry Norms & Prior Art

- The `@settings` block is a CSS comment containing YAML, appended after the
  theme's CSS. The Primary theme carries one such block, 3708 lines, 517
  settings. **Source:** `.obsidian/themes/Primary/theme.css:171-3878`.
- A `class-toggle`'s `id` **is** the body class, verbatim, un-namespaced —
  `alt-folder-icons` occurs 9× in the theme's CSS, always as
  `body.alt-folder-icons …`. A `class-select` applies the **selected option's
  `value`** as the class; its own `id` never appears in CSS. The default
  option's class is a no-op sentinel with zero CSS occurrences. **Source:**
  theme.css, YAML cross-checked against CSS. (record 0002)
- Obsidian's settings have **no collapsible sections** (`grep -i
  "setting.*collaps"` over app.css → 0 matches) and **no global search** (the
  modal chrome creates no search input; per-tab search empties and refills a
  `SettingGroup`'s `listEl`). Its setting tabs are **100% imperative**.
  **Source:** app.js, app.css. (record 0004)
- Obsidian's `ColorComponent` is a native `<input type="color">`, 6-digit hex,
  **no alpha channel anywhere** (`getValueAlpha`/`setValueAlpha` → 0 hits in
  app.js; the only persisted `a` field, in graph colour groups, is hardcoded to
  `1`). **Source:** app.js minified class `nC`. (record 0004)

## Current Codebase State

<!-- docwright:generated:start -->
- `src/renderer/ui/Setting.ts` — `SettingGroup` (:693) is a faithful port of
  Obsidian's `qk`; `ColorComponent` (:516) a faithful port of `nC` (hex only);
  `SliderComponent` (:607), `ToggleComponent` (:395), `DropdownComponent`
  (:349), `TextComponent` (:183).
- `src/renderer/app/SettingTab.ts` — an **invented** declarative engine with no
  counterpart in app.js. Groups cannot nest (`SettingGroupItem`, :167-169);
  drill-down pages break below depth 2 (`openPage` :736-768 re-renders the
  root); it references CSS classes that exist nowhere in the repo. **No builtin
  tab uses it.**
- `src/renderer/builtin/AppearanceSettingTab.ts:11` — `implements SettingTab`,
  imperative, like every other builtin.
- `src/renderer/builtin/SettingsRenderer.ts:312-319` — `getTabSection` sends a
  tab with no `section` into "Core plugins".
- `src/renderer/app/theme/ThemeManager.ts:51-58` — has the theme's raw CSS in
  hand; `applyThemeFromVault` never calls `registerTheme`, so
  `getActiveTheme()` returns `null` on that path.
- `src/renderer/app/theme/CustomCss.ts:180` — fires
  `workspace.trigger("css-change", id)`; the same event name is emitted for
  translucency, accent colour, font size, and every plugin/snippet style.
- `src/renderer/app/theme/CssSnippetManager.ts:3-17` — snippets carry `cssText`.
- `src/renderer/app/BodyClasses.ts:50-82` — a `MutationObserver` on
  `["class","style"]` copies the main body's `style.cssText` into popouts.
- `src/renderer/vault/Vault.ts:452-462` — `readConfigJson` / `writeConfigJson`.
  `writeJson` (:487-497) swallows write failures; `readJson` (:468-479) returns
  `null` for missing but `undefined` for corrupt.
- `src/renderer/core/ApiUtils.ts:322` — `parseYaml`, backed by `yaml@2`, already
  a direct dependency.
- `src/renderer/metadata/Frontmatter.ts` — a hand-rolled YAML subset that
  **silently corrupts** a nested list-of-maps. Must not be reused.
<!-- docwright:generated:end -->

## Findings

### F1: The `@settings` block is flat; hierarchy is implied by heading markers

- **Decision**: Parse the block into a tree ourselves. `settings` is a flat
  list of 517 maps; `heading` items carry `level` (1–4) and `collapsed`, and
  items belong to the preceding heading by document order.
- **Rationale**: There is no nested `settings:` key anywhere in the block.
- **Alternatives considered**: Expecting a nested structure — would break on
  every real theme.

### F2: Emission format is dictated by the consuming CSS, not by taste

- **Decision**: `class-toggle` → body class = `id`. `class-select` → body class
  = the selected option's `value`. `variable-themed-color` / `hsl` → the whole
  colour (`hsla(…)`). `variable-themed-color` / `rgb-values` → a **bare
  triplet** (`182, 175, 166`). `variable-number` →
  `String(value) + (format ?? "")`. `variable-text` with `quotes: true` →
  quoted.
- **Rationale**: app.css consumes the rgb-values ones as
  `rgba(var(--canvas-color), 0.1)`; emitting `rgb(…)` would produce
  `rgb(rgb(…))` and the declaration would drop. `--ribbon-width` is used inside
  `calc()`, so a unitless number is invalid. A scan of all 259 hsl ids finds no
  `-h`/`-s`/`-l` companion properties, so there is no channel decomposition.
- **Alternatives considered**: Channel-decomposed colours; unitless numbers —
  both produce invalid CSS against the real theme. (record 0002)

### F3: The variable tier must be inline custom properties on `<body>`

- **Decision**: `document.body.style.setProperty(name, value)`. No generated
  `<style>`, no `:root` block.
- **Rationale**: Measured, not reasoned. Every variable in this app is declared
  on `<body>` (`tokens.css:23`; `.theme-dark`/`.theme-light` also match body).
  Custom properties inherit, and a declaration on the element itself always
  beats one inherited from its parent — so an `:root`/`<html>` override cannot
  win at any specificity or source order. An inline style attribute outranks
  every author selector matching the same element. It also reaches popout
  windows for free via the existing body-style `MutationObserver`, whereas no
  code path copies `<style>` elements into a popout.
- **Alternatives considered**: `:root` in a late `<style>` (loses);
  `.theme-dark` in a late `<style>` (loses to any theme using
  `body.theme-dark`); the `registerCss` slot (inserted *before* the theme —
  loses outright). (record 0001)

### F4: The config store will betray a naive implementation three ways

- **Decision**: Persist to `.obsidian/style-settings.json` via
  `writeConfigJson`, namespaced by the declaring block's `id`, copying
  `MetadataTypeManager`'s whole-document write plus **mtime echo-guard**.
  Distinguish `readJson`'s `null` (missing) from `undefined` (corrupt) before
  ever writing.
- **Rationale**: `JsonStore.write` re-enters your own `raw` listener on every
  save; `writeJson` swallows failures; `?? DEFAULTS` on a corrupt file would
  overwrite 500+ user settings with defaults on the next save.
- **Alternatives considered**: `vault.setConfig` — unknown keys land in
  `app.json` and would pollute it with hundreds of theme values. (record 0003)

### F5: "Align with Obsidian" means going imperative, not deepening the invented engine

- **Decision**: Build the tab imperatively on `SettingGroup`, like every real
  Obsidian tab and every builtin here. Do not extend `SettingTab.ts`'s
  declarative engine.
- **Rationale**: The engine has no counterpart in app.js, cannot nest groups,
  and its drill-down pages break below depth 2. Extending it would deepen a
  divergence from Obsidian, not close it. Because an imperative tab owns its own
  parsed tree, ancestor-aware search and collapse are straightforward — and they
  are impossible in the engine, whose `RenderedDomState` carries no identity, no
  path and no parent link.
- **Alternatives considered**: Fixing the engine first — large, and aimed at an
  abstraction Obsidian does not have. (record 0004)

### F6: Collapsible headings and an alpha colour control must be invented, in Obsidian's idiom

- **Decision**: Collapse — reuse Obsidian's own collapse idiom
  (`.collapse-icon` + the `right-triangle` atom, as the nav panes do) on the
  `SettingGroup` heading row, plus the settings CSS it needs. Alpha — compose
  Obsidian's own `ColorComponent` (hex) with its `SliderComponent` (opacity):
  one row, two controls. The 7 `opacity: false` colours get the picker alone.
- **Rationale**: Obsidian's settings have zero collapsible sections and zero
  alpha-capable colour controls, so neither can be copied. The theme forces
  both (69 collapsed headings; 259 `opacity: true` colours). Composing existing
  primitives keeps the invention inside Obsidian's vocabulary.
- **Alternatives considered**: A bespoke alpha picker component (net-new
  component + CSS, visually divergent); no collapse at all (ignores the theme's
  declared `collapsed: true` and yields one 517-row list). (record 0004)
