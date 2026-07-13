=== Contract ===

# Task Contract: obsidian appearance parity

## Intent
Make Settings → Appearance read and behave like an Obsidian-owned surface instead of an
internal configuration form. The panel must use the repository's native `Setting` primitives,
present the sections and controls in the order established by the bundled Obsidian 1.12.7
reference, expose the appearance capabilities Attention already implements, and remove all
developer-facing copy from the user interface.

## Current State
- `AppearanceSettingTab` exposes only base theme, accent, installed theme, marketplace and
  snippet toggles. It uses a text field for the accent color, omits the implemented font and
  interface preferences, has no reset/reload/folder actions, and describes implementation
  details such as CSS cascade order to users.
- `AppearanceManager` already persists and applies the three font families, 10–30 px base font
  size, base theme and accent color. `App` already reacts to `showInlineTitle`, `showViewHeader`,
  `showRibbon` and `nativeMenus`; `CustomCss` already discovers themes/snippets and applies
  translucency.
- The read-only reference `decode-obsidian/ref/obsidian/app.js` (Obsidian 1.12.7) establishes:
  base scheme → accent → themes, then Interface, Font, Advanced and CSS snippets groups; native
  color picker and reset buttons; a default-theme choice; font management and font-size reset;
  and reload/open-folder actions on the snippets heading.
- The shared `Setting`, `SettingGroup`, `ColorComponent`, `SliderComponent`, toggles, buttons and
  dropdowns already provide the required Obsidian DOM classes and styling. No new control system
  is needed.

## UX Shape
```text
Appearance
├─ Theme: Base color scheme · Accent color · Themes · Installed count
├─ Interface: Inline title · View header · Ribbon
├─ Font: Interface · Text · Monospace · Font size
├─ Advanced: Native menus · Translucent window
└─ CSS snippets [Reload] [Open folder]
   ├─ empty-state guidance, or
   └─ one native toggle row per snippet
```

## Must
- pnpm is the only package manager; a preinstall hook rejects npm and yarn.
- Fail fast on product paths: a missing configuration raises an explicit
- The full vitest suite is green before any merge.
- Keep the perf budget on the 20k-file vault: openFile median under 50ms
- Code stays name-agnostic: no product-name literal appears anywhere in the

## Must NOT
- Do not add a production dependency without a goal contract that adopts it.
- Do not weaken, skip, or delete an existing test to make a gate pass.
- Do not source a default from anywhere but the user's explicit configuration.

## Decisions
- One app, one package: the repo root is the single application package; its
- The native seam is ports-and-adapters: the shell fills the ports the renderer
- Dual-track plugin architecture: `builtin/` is the internal track and may use
- Kernel direction rule: `vault/`, `metadata/`, and `storage/` import only from
- Disk access stays in-process behind the `DataAdapter` seam in the renderer
- Unit tests are centralized under `tests/` (workspace member), mirroring
- The docs household is docwright goals under
- The behavior and section order in the bundled Obsidian 1.12.7 `app.js` are the parity baseline.
- Rebuild only `AppearanceSettingTab` and the smallest missing appearance service seams. Reuse
- The opening theme block is unheaded, matching Obsidian. It contains base color scheme, accent
- Accent color uses the native `ColorComponent`. A rotate-counterclockwise extra button clears
- Interface controls expose only behaviors already supported by `App`: inline title, view header
- Font rows use native text controls for comma-separated CSS font families. This is a deliberate
- Advanced exposes native menus and translucency only. Translucency needs one explicit
- The CSS snippets heading owns Reload and Open folder extra buttons. Reload awaits discovery and
- Theme and snippets folders are created on demand before being opened. The implementation uses
- Existing `setting-group`/`setting-item` CSS is authoritative. Add CSS only if source-backed DOM

## Boundaries
Allowed changes:
- src/renderer/builtin/AppearanceSettingTab.ts
- src/renderer/app/theme/AppearanceManager.ts
- src/renderer/app/theme/CustomCss.ts
- src/renderer/app/theme/ThemeManager.ts
- src/renderer/app/theme/CssSnippetManager.ts
- src/renderer/ui/Setting.ts
- src/renderer/styles/features/settings-item.css
- tests/web/builtin/AppearanceSettingTab.test.ts
- tests/web/app/theme/**
- tests/web/app/AppPublicApi.test.ts
- docs/architecture/obsidian-appearance-parity/**
Forbidden:
- Do not modify `decode-obsidian/**`; it is read-only evidence.
- Do not add a dependency, React surface, copied Obsidian implementation, or parallel setting
- Do not implement unsupported desktop appearance features such as zoom level, frame style,
- Do not redesign the theme marketplace or change theme/snippet storage formats.
- Do not weaken existing appearance, config, theme marketplace or CSS snippet assertions.
Out of scope:
- Obsidian's OS font enumeration/search modal and missing-font diagnostics.
- Mobile-only appearance controls and desktop shell controls not already implemented by Attention.
- Theme update checks, marketplace redesign, plugin appearance settings and editor tab-size settings.
- A global visual audit of views outside Settings → Appearance.

## Completion Criteria

Rule: source-shape — the panel follows Obsidian's native information architecture
Scenario: appearance groups render in source order
  Test:
    Filter: renders Obsidian appearance groups in source order
    Level: component
  Given the Appearance settings tab is opened
  When its content is rendered
  Then the unheaded theme block is followed by Interface, Font, Advanced and CSS snippets

Scenario: implementation copy never reaches the user
  Test:
    Filter: uses user-facing appearance copy
    Level: component
  Given the Appearance settings tab is rendered
  When its visible descriptions are read
  Then they describe user outcomes and contain no source-code or CSS-cascade terminology


Rule: theme-controls — base theme, accent and community themes are complete
Scenario: base scheme changes through the native dropdown
  Test:
    Filter: changes the base color scheme
    Level: component
  Given the panel reflects the persisted system color scheme
  When the user chooses Dark
  Then theme config becomes obsidian and the dark body class is applied

Scenario: accent picker changes and resets the accent
  Test:
    Filter: changes and resets the accent color
    Level: component
  Given no custom accent is configured
  When the user chooses a color and then activates Restore default
  Then accent config is cleared and the picker reflects the computed theme accent

Scenario: a vault without community themes still has Default selected
  Test:
    Filter: shows Default when no community theme is installed
    Level: component
  Given no community themes are registered
  When the theme control renders
  Then Default is its selected option and selecting it clears cssTheme

Scenario: installed community themes remain browsable
  Test:
    Filter: lists installed themes and opens the community browser
    Level: component
  Given two installed themes are registered
  When the panel renders and Browse is activated
  Then both themes appear in the selector, the installed count is two and the marketplace opens


Rule: interface-controls — supported workspace chrome is configurable here
Scenario: interface toggles persist and update workspace chrome
  Test:
    Filter: toggles supported interface chrome
    Level: component
  Given inline title, view header and ribbon are visible
  When each corresponding toggle is turned off
  Then each config value is false and its existing body-class behavior is updated


Rule: font-controls — implemented typography settings are usable
Scenario: font families update the existing appearance manager
  Test:
    Filter: changes all appearance font families
    Level: component
  Given the three font family controls are visible
  When interface, text and monospace families are entered
  Then their vault config keys and CSS override variables contain the entered families

Scenario: font size is bounded and resettable
  Test:
    Filter: changes and resets the base font size
    Level: component
  Given base font size is 20
  When the slider changes and Restore default is activated
  Then the configured and rendered font size returns to 16 pixels


Rule: advanced-controls — native desktop appearance switches stay in sync
Scenario: native menus and translucency apply immediately
  Test:
    Filter: toggles native menus and translucency
    Level: component
  Given both advanced settings are disabled
  When the user enables both toggles
  Then both config values are true and the translucent body class is present


Rule: snippet-controls — snippet discovery has complete actions and states
Scenario: snippet heading reloads discovery without duplicate rows
  Test:
    Filter: reloads CSS snippets without duplicate rows
    Level: component
  Given one snippet is present on disk
  When Reload snippets is activated twice
  Then the panel contains one row for that snippet with its vault-relative path

Scenario: missing snippet folder shows actionable guidance
  Test:
    Filter: shows the CSS snippets empty state
    Level: component
  Given no CSS snippets are discovered
  When the panel renders
  Then it says no snippets were found and names vault/.obsidian/snippets

Scenario: theme and snippet folders open after on-demand creation
  Test:
    Filter: creates and opens appearance folders
    Level: component
  Given the theme and snippet folders do not exist
  When each Open folder action is activated
  Then each folder is created and passed to the app's default opener

Scenario: snippet toggles persist their enabled state
  Test:
    Filter: toggles a CSS snippet from Appearance
    Level: component
  Given a discovered disabled snippet
  When its native toggle is enabled
  Then enabledCssSnippets contains its id and its style load is requested

=== Codebase Context ===

Files (3):
  - docs/architecture/obsidian-appearance-parity/spec.md
  - tests/web/app/theme/CssContract.test.ts
  - tests/web/app/theme/CustomCss.test.ts

=== Task Sketch ===

Group 1 (order 1):
  Scenarios:
    - appearance groups render in source order
    - implementation copy never reaches the user
    - base scheme changes through the native dropdown
    - accent picker changes and resets the accent
    - a vault without community themes still has Default selected
    - installed community themes remain browsable
    - interface toggles persist and update workspace chrome
    - font families update the existing appearance manager
    - font size is bounded and resettable
    - native menus and translucency apply immediately
    - snippet heading reloads discovery without duplicate rows
    - missing snippet folder shows actionable guidance
    - theme and snippet folders open after on-demand creation
    - snippet toggles persist their enabled state
  Boundary paths:
    - src/renderer/builtin/AppearanceSettingTab.ts
    - src/renderer/app/theme/AppearanceManager.ts
    - src/renderer/app/theme/CustomCss.ts
    - src/renderer/app/theme/ThemeManager.ts
    - src/renderer/app/theme/CssSnippetManager.ts
    - src/renderer/ui/Setting.ts
    - src/renderer/styles/features/settings-item.css
    - tests/web/builtin/AppearanceSettingTab.test.ts
    - tests/web/app/theme/**
    - tests/web/app/AppPublicApi.test.ts
    - docs/architecture/obsidian-appearance-parity/**
  Test selectors:
    - renders Obsidian appearance groups in source order
    - uses user-facing appearance copy
    - changes the base color scheme
    - changes and resets the accent color
    - shows Default when no community theme is installed
    - lists installed themes and opens the community browser
    - toggles supported interface chrome
    - changes all appearance font families
    - changes and resets the base font size
    - toggles native menus and translucency
    - reloads CSS snippets without duplicate rows
    - shows the CSS snippets empty state
    - creates and opens appearance folders
    - toggles a CSS snippet from Appearance

=== Warnings ===

  - Allowed Changes path not found: tests/web/builtin/AppearanceSettingTab.test.ts (resolved to ./tests/web/builtin/AppearanceSettingTab.test.ts)
