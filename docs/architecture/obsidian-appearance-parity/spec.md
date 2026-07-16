spec: task
name: "obsidian appearance parity"
inherits: project
tags: [architecture, ui, appearance, obsidian-parity]
estimate: 2d
test_command: pnpm vitest run tests/web/builtin/AppearanceSettingTab.test.ts tests/web/builtin/theme-market/ThemeMarket.test.ts tests/web/builtin/theme-market/ThemeMarketplaceModal.test.ts tests/desktop/ipc.test.ts tests/desktop/preload.test.ts tests/desktop/vault-windows.test.ts tests/web/builtin/git/GitThemeContract.test.ts tests/web/builtin/git/review/GitReviewView.test.ts -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Make appearance changes propagate through Obsidian-native seams. Settings → Appearance must read
and behave like an Obsidian-owned surface instead of an internal configuration form, and the
local Git surfaces must consume the same live theme tokens instead of retaining Pierre's isolated
default palette or product-owned literal colors. The panel must use the repository's native
`Setting` primitives, present the source-backed section order, expose capabilities Attention
already implements, and remove developer-facing copy from the user interface.

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
- User validation after the first implementation slice found that enabling the bundled Primary
  theme changed core Obsidian surfaces but left Git diffs visually unchanged. Pierre renders
  inside a shadow root with its own `--diffs-*` palette, and mounted instances only read
  `themeType` at construction; local Git CSS also retains a few literal status/border colors.

## UX Shape

```text
Appearance
├─ Theme: Base color scheme · Accent color · Themes · update manager
├─ Interface: Inline title · View header · Ribbon manager
├─ Font: Interface · Text · Monospace · availability · Font size
├─ Advanced (desktop): Zoom · Native menus · Frame · Icon · Translucency · GPU
└─ CSS snippets [Reload] [Open folder]
   ├─ empty-state guidance, or
   └─ one native toggle row per snippet
```

## Decisions

- The behavior and section order in the bundled Obsidian 1.12.7 `app.js` are the parity baseline.
  Attention does not copy proprietary source; it recreates observable DOM and behavior with the
  existing vanilla `Setting` API.
- Rebuild only `AppearanceSettingTab` and the smallest missing appearance service seams. Reuse
  `AppearanceManager`, `ThemeManager`, `CustomCss`, `CssSnippetManager` and
  `ThemeMarketplaceModal`; add no dependency and no appearance-specific component framework.
- The opening theme block is unheaded, matching Obsidian. It contains base color scheme, accent
  color, themes and an installed-theme summary. The theme dropdown always starts with
  `Default`, so a vault with no community theme never produces an empty or invalid control.
- Accent color uses the native `ColorComponent`. A rotate-counterclockwise extra button clears
  the configured accent, restores the computed theme accent in the picker and exposes disabled
  state when there is nothing to reset.
- Interface controls expose only behaviors already supported by `App`: inline title, view header
  and ribbon visibility. Changes go through vault config so existing config-change handlers own
  body/workspace updates.
- Font rows open a native manager view built from the shared modal, setting and input-suggestion
  primitives. The manager supports adding, removing and reordering comma-separated CSS font
  families, shows the source-shaped applied summary and found/missing status icons, offers a
  searchable suggestion popup, and saves through `AppearanceManager`. Font suggestions follow
  Obsidian's get-fonts seam: the main process enumerates OS font families via the open-source
  `font-list` package (Obsidian's proprietary `get-fonts` addon is UNLICENSED and not copied),
  exposed as `ipcRenderer.invoke("get-fonts")`, merged with a source-shaped seed list, then
  canvas-filtered to families that actually resolve. Availability checks await
  `document.fonts.ready` before `fonts.check`. Font size uses the existing native slider with
  10–30 limits, a live value tooltip and a reset-to-16 action; the mobile base-font-size action
  is exposed beside it.
- Ribbon configuration opens a native manager view over the existing `WorkspaceRibbon` items.
  Visible and hidden sections use Obsidian's source classes, minus/plus actions and drag order;
  every mutation updates the shared ribbon state and its existing layout persistence seam.
- Current themes checks the community catalog against installed manifest versions. The row exposes
  Check for updates, View updates and Update all states, while the existing theme marketplace is
  reused in update-only mode instead of adding a second theme-management surface.
- Font rows describe the configured fallback order and mark unavailable families with the native
  warning icon before opening the existing font manager.
- Desktop Advanced uses Electron's existing renderer/main seam: `webFrame` owns zoom; main-process
  settings own frame style, custom icon and GPU disablement; changes that require restart reveal one
  Relaunch action. Custom icons are normalized to a persisted PNG before being applied. Native menus
  and translucency retain their existing immediate behavior.
- No additional mobile Appearance controls or mobile ribbon configuration are implemented in this
  goal; the already-present mobile base-font-size compatibility toggle is left unchanged.
- The CSS snippets heading owns Reload and Open folder extra buttons. Reload awaits discovery and
  rebuilds the panel exactly once; the empty state names the vault-relative snippets directory;
  populated rows show that snippet's vault-relative file path.
- Theme and snippets folders are created on demand before being opened. The implementation uses
  the existing vault and app file APIs and reports failures through the existing Notice surface.
- Existing `setting-group`/`setting-item` CSS is authoritative. Add CSS only if source-backed DOM
  still lacks a local layout rule; do not compensate for wrong markup with bespoke selectors.
- Git chrome uses only Obsidian semantic tokens. The Pierre custom-element host bridges those
  tokens into `--diffs-*` background, foreground, gutter, font and semantic change variables so
  shadow-root content follows every community theme without knowing theme names.
- Mounted `CodeView` and `FileDiff` instances react to the existing workspace `css-change` event:
  CSS variables update naturally, while the light/dark syntax theme is refreshed in place. No Git
  view is torn down and no theme-specific stylesheet is introduced.

<!-- lint-ack: decision-coverage — the proprietary-source non-copy rule and native Setting reuse are architectural constraints enforced by boundaries and review; all observable decisions have scenarios -->
<!-- lint-ack: error-path — the no-themes and no-snippets scenarios are the user-visible empty/error paths; linter does not classify empty-state wording as failure language -->

## Boundaries

### Allowed Changes

- src/renderer/builtin/AppearanceSettingTab.ts
- src/renderer/builtin/AppearanceModals.ts
- src/renderer/builtin/theme-market/ThemeInstaller.ts
- src/renderer/builtin/theme-market/ThemeMarketplace.ts
- src/renderer/builtin/theme-market/ThemeMarketplaceModal.ts
- src/renderer/app/theme/AppearanceManager.ts
- src/renderer/app/theme/CustomCss.ts
- src/renderer/app/theme/ThemeManager.ts
- src/renderer/app/theme/CssSnippetManager.ts
- src/renderer/ui/Setting.ts
- src/renderer/views/workspace/WorkspaceRibbon.ts
- src/renderer/app/App.ts
- src/renderer/app/FrameDom.ts
- src/preload/preload.ts
- src/shared/ipc.ts
- src/main/ipc.ts
- src/main/main.ts
- src/main/settings.ts
- src/main/vault-windows.ts
- src/main/desktop-bridge.ts
- src/main/system-fonts.ts
- src/renderer/styles/features/settings-item.css
- src/renderer/styles/product/git-changes.css
- src/renderer/styles/product/git-review.css
- src/renderer/builtin/git/GitChangesView.ts
- src/renderer/builtin/git/GitLogView.ts
- src/renderer/builtin/git/review/GitReviewView.ts
- src/renderer/builtin/git/review/ReviewSurface.ts
- tests/web/builtin/AppearanceSettingTab.test.ts
- tests/web/builtin/theme-market/ThemeMarketplaceModal.test.ts
- tests/web/builtin/theme-market/ThemeMarket.test.ts
- tests/desktop/ipc.test.ts
- tests/desktop/preload.test.ts
- tests/desktop/vault-windows.test.ts
- tests/architecture.test.ts
- tests/web/builtin/git/GitThemeContract.test.ts
- tests/web/builtin/git/review/GitReviewView.test.ts
- tests/web/app/theme/**
- tests/web/app/AppPublicApi.test.ts
- docs/architecture.md
- docs/architecture/obsidian-appearance-parity/**

### Forbidden

- Do not modify `decode-obsidian/**`; it is read-only evidence.
- Do not add a dependency, React surface, copied Obsidian implementation, or parallel setting
  component hierarchy.
- Do not redesign the theme marketplace or change theme/snippet storage formats.
- Do not add the remaining mobile Interface settings or mobile quick-ribbon selector.
- Do not weaken existing appearance, config, theme marketplace or CSS snippet assertions.
- Do not add a Git-specific palette, community-theme allowlist, selector patch for an individual
  theme, or reach into Pierre's shadow root after render.

## Completion Criteria

### Rule: source-shape — the panel follows Obsidian's native information architecture

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

### Rule: theme-controls — base theme, accent and community themes are complete

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
  When the panel renders and Manage is activated
  Then both themes appear in the selector, the installed count is two and the marketplace opens

Scenario: installed themes can be checked and updated
  Test:
    Filter: checks and updates installed community themes
    Level: component
  Given an installed theme has an older manifest version than the community catalog
  When the user checks updates, opens View updates and activates Update all themes
  Then the update-only manager lists that theme and its vault package is replaced by the newer version

### Rule: interface-controls — supported workspace chrome is configurable here

Scenario: interface toggles persist and update workspace chrome
  Test:
    Filter: toggles supported interface chrome
    Level: component
  Given inline title, view header and ribbon are visible
  When each corresponding toggle is turned off
  Then each config value is false and its existing body-class behavior is updated

Scenario: ribbon actions are configurable
  Test:
    Filter: opens the ribbon configuration view
    Level: component
  Given the Configure ribbon setting is visible
  When the user opens it and hides a ribbon action
  Then the action is hidden through the shared ribbon state

Scenario: ribbon manager separates hidden actions and persists drag order
  Test:
    Filter: manages visible hidden and ordered ribbon actions
    Level: component
  Given the ribbon contains visible and hidden actions
  When the user removes, adds and drags an action in Configure ribbon
  Then the source-shaped sections reflect the new visibility and the shared ribbon order is persisted


### Rule: font-controls — implemented typography settings are usable

Scenario: font manager updates the existing appearance manager
  Test:
    Filter: manages all appearance font families
    Level: component
  Given the three font family controls are visible
  When each Manage view adds a family and saves
  Then the modal closes and their vault config keys and CSS override variables contain the entered families

Scenario: font rows show fallback order and missing-family status
  Test:
    Filter: describes configured font fallback status
    Level: component
  Given a font setting contains one available and one unavailable family
  When Appearance renders the Font group
  Then both families are listed in fallback order and the unavailable family has a Font not found warning

Scenario: font manager offers source-shaped font suggestions
  Test:
    Filter: opens the Obsidian-style font suggestion list
    Level: component
  Given a Font manager is open
  When the font name input receives focus
  Then a searchable suggestion popup lists available seeded font families

Scenario: font size is bounded and resettable
  Test:
    Filter: changes and resets the base font size
    Level: component
  Given base font size is 20
  When the slider changes and Restore default is activated
  Then the configured and rendered font size returns to 16 pixels

Scenario: mobile base font size action persists
  Test:
    Filter: toggles the mobile base font size action
    Level: component
  Given the mobile base font size action is disabled
  When the user enables it
  Then baseFontSizeAction is true

### Rule: advanced-controls — native desktop appearance switches stay in sync

Scenario: native menus and translucency apply immediately
  Test:
    Filter: toggles native menus and translucency
    Level: component
  Given both advanced settings are disabled
  When the user enables both toggles
  Then both config values are true and the translucent body class is present

Scenario: desktop zoom updates the current Electron web frame
  Test:
    Filter: changes and resets desktop zoom
    Level: component
  Given the current desktop zoom level is nonzero
  When the user changes the Zoom level slider and activates Restore default
  Then Electron webFrame receives the changed level and then zero

Scenario: restart-bound desktop settings persist and relaunch
  Test:
    Filter: configures desktop frame icon and hardware acceleration
    Level: component
  Given desktop frame, icon and GPU channels are available
  When the user changes frame style, chooses a valid custom icon and disables hardware acceleration
  Then each main-process setting is persisted, the icon preview is shown and the Relaunch action invokes Electron relaunch

Scenario: desktop native settings drive the next vault window
  Test:
    Filter: applies desktop appearance settings to vault windows
    Level: integration
  Given native frame style and a persisted custom icon are configured
  When a vault window is created after relaunch
  Then BrowserWindow uses the native frame and configured icon path

### Rule: snippet-controls — snippet discovery has complete actions and states

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

### Rule: git-theme-inheritance — local Git consumes the active Obsidian theme

Scenario: git diff hosts bridge native theme tokens into Pierre
  Test:
    Filter: bridges Obsidian theme tokens into git diff hosts
    Level: architecture
  Given Pierre diffs render inside their custom-element shadow roots
  When the local Git styles define the custom-element host contract
  Then backgrounds, foregrounds, gutters, fonts and change colors resolve from Obsidian tokens

Scenario: mounted review diffs refresh after a theme change
  Test:
    Filter: refreshes mounted review diffs when the theme changes
    Level: component
  Given a dark local review is already mounted
  When Appearance changes the base scheme to Light and emits css-change
  Then the existing code view receives light options and rerenders without reopening the leaf

Scenario: mounted file diffs refresh after a theme change
  Test:
    Filter: refreshes mounted file diffs on css-change
    Level: architecture
  Given Git changes and commit log have already rendered file diffs
  When the workspace emits css-change
  Then both views update their existing FileDiff theme type without rebuilding the view

Scenario: local Git chrome owns no literal palette
  Test:
    Filter: keeps local git chrome free of literal palette colors
    Level: architecture
  Given the local Git product styles
  When their color declarations are inspected
  Then semantic colors use Obsidian variables with no hex, rgb, hsl or theme-name override

## Out of Scope

- OS-wide font enumeration beyond browser font availability checks.
- Mobile Interface controls and mobile quick-ribbon selection.
- Plugin appearance settings and editor tab-size settings.
- A global visual audit outside Settings → Appearance and the local Git surfaces.
- Cloud GitHub theme inheritance; it can adopt the same host bridge in a separate bounded goal.

## Open Questions

None.
