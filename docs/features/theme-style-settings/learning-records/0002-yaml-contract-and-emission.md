---
record: 0002
goal: theme style settings
round: the @settings YAML contract and the CSS it must emit
status: confirmed
---

# The `@settings` contract, read off a real shipping theme

Primary source: `.obsidian/themes/Primary/theme.css` — CSS on lines 1–170, a
single `/* @settings … */` YAML block on lines 171–3878 (517 settings). The
Style Settings plugin itself is **not** on this machine, so every semantic
below is derived from the theme's own YAML *cross-checked against how the
theme's and Obsidian's CSS consume it*. Nothing here is recalled from memory.

## Block shape

Three top-level keys — `name`, `id`, `settings`. `settings` is a **flat** list
of 517 maps. Hierarchy is implied only by `heading` items carrying `level` (1–4)
and `collapsed`; items belong to the preceding heading by document order. There
is no nested `settings:` key anywhere.

## Body classes: the id *is* the class

- `class-toggle` (19): fields `id`, `type`, `title`, optional `description`.
  **No `default` field exists on any of the 19** — off is implicit. The `id` is
  applied verbatim as a body class, confirmed against the CSS half:
  `alt-folder-icons` appears 9× and always as `body.alt-folder-icons …`.
- `class-select` (5): `id`, `type`, `title`, `allowEmpty`, `default`, and
  `options` (a list of `{label, value}`). The **selected option's `value`** is
  the body class (`body.ribbon-slideout`). The select's own `id`
  (`ribbon_styles`) never appears in the CSS — it is only the storage key.
- The **default option's class is a no-op sentinel**: `ribbon-default`,
  `sb-default`, `file-header-default` etc. occur **zero times** in the CSS. The
  base stylesheet *is* the default look; only non-default options carry rules.

No namespacing by the block's `id`. A naive "namespace it to be safe" design
would break every theme in the ecosystem.

## Emission format, proven from the consuming CSS

| type | emit | proof |
| --- | --- | --- |
| `variable-themed-color`, `format: hsl`, `opacity: true` (259) | the whole colour: `hsla(34, 34%, 90%, 1)` | consumed as `background-color: var(--ribbon-background)`. A scan for `-h`/`-s`/`-l`/`-rgb` companion properties on all 259 ids returns **0 hits** — there is no channel decomposition. |
| `variable-themed-color`, `format: rgb-values`, `opacity: false` (7) | a **bare triplet**: `182, 175, 166` | consumed as `rgb(var(--canvas-color))` and `rgba(var(--canvas-color), 0.1)` (app.css:16647, :16727). Emitting `rgb(…)` would yield `rgb(rgb(…))` → invalid, declaration dropped. An alpha channel would make `rgba()` take 4 args → also invalid. `opacity: false` is load-bearing, not cosmetic. |
| `variable-number` with `format: px`/`em` (11) | value **plus the unit** | `--ribbon-width` is used inside `calc(-1 * var(--ribbon-width) / 4)`; `--indentation-guide-reading-indent` lands in `inset-inline-start`. A unitless number is invalid in both. |
| `variable-number` with no `format` (28) | bare number | font weights, line-heights, opacities — unitless by spec. |
| `variable-text` with `quotes: true` (6) | quoted | all six are font families. |
| `variable-select`, `variable-number-slider` | the value verbatim | |

So: `emitted = String(value) + (format ?? "")` for numbers, and the format field
of a themed colour selects between *whole colour* and *bare triplet*.

## The parser trap

The block **mixes tabs and 4-space indentation**. Measured against the repo's
own `yaml@2` (already a direct dependency; `parseYaml` is exported from
`src/renderer/core/ApiUtils.ts:322`):

| input | result |
| --- | --- |
| raw block | throws `YAMLParseError: Tabs are not allowed as indentation` |
| leading tabs → **4 spaces** | parses, `settings.length === 517` |
| leading tabs → 2 spaces | throws — misaligns against the 4-space siblings |

The repo's hand-rolled frontmatter parser (`src/renderer/metadata/Frontmatter.ts`)
**must not** be reused: fed a real `class-select`, it silently merged two
settings into one, collapsed `options` to its last entry, leaked `default`
across items — and returned `valid: true`. Silent corruption, not an error.

## Decision

Parse with `yaml@2` after expanding leading tabs to four spaces. Apply
`class-toggle` ids and `class-select` option values verbatim as body classes.
Emit variables per the table above.
