spec: task
name: "Obsidian Community Plugins Parity"
inherits: project
tags: [architecture, parity, community-plugins]
estimate: 1d
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Bring the existing Community plugins settings and marketplace surfaces into
behavioral and DOM parity with the checked-in Obsidian implementation. Reuse
the existing plugin catalog, installer, registry, Markdown renderer, settings,
modal, menu, icon, and notice systems instead of adding another plugin system.

## Current State

Plugin discovery, installation, updates, enable/disable, and catalog loading
already work. The marketplace still auto-selects its first result, hand-builds
search and installed-only controls, renders a non-Obsidian detail hierarchy,
and leaves relative README media unresolved; the settings page also differs
from Obsidian's setting order, disclaimer rows, and installed-plugin controls.

## Decisions

- Port the DOM and behavior from `decode-obsidian/ref/obsidian/app.js` classes
  `y0`, `M0`, and `ite`; the checked-in bundle is the source of truth.
- Compose the existing `Modal`, `Setting`, `SettingGroup`, `Menu`, `Notice`,
  `MarkdownRenderer`, fuzzy search, icon, plugin marketplace, and installer APIs.
- Open the marketplace as an unselected grid; append details only after a user
  selects an item, and return to the grid through the back action or Escape.
- Render plugin cards with fuzzy highlights, installed flair, download icon and
  count, relative update time, and description in Obsidian's element order.
- Resolve relative README image and video sources against
  `https://raw.githubusercontent.com/<repo>/HEAD/` after Markdown rendering.
- Render the enabled and restricted settings states in Obsidian's setting order,
  including reload/open-folder controls and installed plugin action ordering.

## Boundaries

### Allowed Changes
- src/renderer/builtin/CommunityPluginMarketplaceModal.ts
- src/renderer/builtin/CommunityPluginsSettingTab.ts
- tests/web/builtin/CommunityPluginMarketplaceModal.test.ts
- tests/web/builtin/CommunityPluginsSettingTab.test.ts
- docs/architecture/obsidian-community-plugins-parity/**

### Forbidden
- Do not add production dependencies or new CSS rules.
- Do not duplicate the catalog, installer, registry, modal, settings, icon,
  notice, or Markdown rendering protocols.
- Do not modify plugin package installation, persistence, or execution semantics.
- Do not change the checked-in faithful styles under `src/renderer/styles/**`.

## Completion Criteria

### Rule: marketplace-grid — Marketplace starts as Obsidian's searchable grid
Scenario: Marketplace opens without selecting the first plugin
  Test: opens marketplace as an unselected Obsidian grid
  Given the catalog contains at least two community plugins
  When the Community plugins marketplace opens
  Then it renders Setting-based search, sort, installed-only, summary, and cards without a details pane

Scenario: Missing auto-open plugin becomes a search query
  Test: sets the search query from a missing auto-open plugin id instead of selecting the first item
  Given an auto-open plugin id is absent from the catalog
  When the Community plugins marketplace opens
  Then the id becomes the search query and no plugin details are selected

### Rule: marketplace-detail — Selection uses Obsidian detail behavior
Scenario: Selecting a plugin opens the Obsidian detail hierarchy
  Test: selects a plugin into Obsidian detail layout
  Given an unselected community plugin card is visible
  When the user selects that card
  Then the modal appends the navigation bar, metadata, actions, and README detail pane

Scenario: Plugin README media resolves against the repository
  Test: resolves plugin README media against repository HEAD
  Given a selected plugin README contains relative and GitHub blob media URLs
  When Markdown rendering completes
  Then image and video sources point to raw GitHub repository content

### Rule: settings-surface — Settings follows Obsidian's enabled and restricted states
Scenario: Enabled settings show Obsidian controls and plugin rows
  Test: renders enabled settings in Obsidian order with installed plugin controls
  Given community plugins are enabled and one plugin is installed
  When the Community plugins setting tab renders
  Then restricted mode, marketplace, update, automatic check, reload, folder, search, row actions, and toggle appear in source order

Scenario: Restricted mode shows Obsidian security guidance
  Test: renders Obsidian restricted-mode disclaimer and exits from the CTA
  Given community plugins are restricted
  When the Community plugins setting tab renders and the user activates its CTA
  Then four icon setting rows and the exact security guidance are replaced by enabled settings

### Rule: marketplace-failure — Catalog failures remain recoverable
Scenario: Catalog load failure exposes retry without stale details
  Test: shows catalog load errors and retries from the modal
  Given the first catalog request fails and the next request succeeds
  When the user retries from the marketplace error state
  Then the recovered plugin grid renders without a stale details pane

## Out of Scope

- Mobile swipe animation and virtualized incremental card rendering.
- Changes to community plugin execution isolation or theme inheritance.
- New plugin discovery, installation, update, or persistence mechanisms.

## Open Questions

None.
