=== Contract ===

# Task Contract: Obsidian Community Plugins Parity

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
- Port the DOM and behavior from `decode-obsidian/ref/obsidian/app.js` classes
- Compose the existing `Modal`, `Setting`, `SettingGroup`, `Menu`, `Notice`,
- Open the marketplace as an unselected grid; append details only after a user
- Render plugin cards with fuzzy highlights, installed flair, download icon and
- Resolve relative README image and video sources against
- Render the enabled and restricted settings states in Obsidian's setting order,

## Boundaries

Allowed changes:

- src/renderer/builtin/CommunityPluginMarketplaceModal.ts
- src/renderer/builtin/CommunityPluginsSettingTab.ts
- tests/web/builtin/CommunityPluginMarketplaceModal.test.ts
- tests/web/builtin/CommunityPluginsSettingTab.test.ts
- docs/architecture/obsidian-community-plugins-parity/**
  Forbidden:
- Do not add production dependencies or new CSS rules.
- Do not duplicate the catalog, installer, registry, modal, settings, icon,
- Do not modify plugin package installation, persistence, or execution semantics.
- Do not change the checked-in faithful styles under `src/renderer/styles/**`.
  Out of scope:
- Mobile swipe animation and virtualized incremental card rendering.
- Changes to community plugin execution isolation or theme inheritance.
- New plugin discovery, installation, update, or persistence mechanisms.

## Completion Criteria

Rule: marketplace-grid — Marketplace starts as Obsidian's searchable grid
Scenario: Marketplace opens without selecting the first plugin
Test:
Filter: opens marketplace as an unselected Obsidian grid
Given the catalog contains at least two community plugins
When the Community plugins marketplace opens
Then it renders Setting-based search, sort, installed-only, summary, and cards without a details pane

Scenario: Missing auto-open plugin becomes a search query
Test:
Filter: sets the search query from a missing auto-open plugin id instead of selecting the first item
Given an auto-open plugin id is absent from the catalog
When the Community plugins marketplace opens
Then the id becomes the search query and no plugin details are selected

Rule: marketplace-detail — Selection uses Obsidian detail behavior
Scenario: Selecting a plugin opens the Obsidian detail hierarchy
Test:
Filter: selects a plugin into Obsidian detail layout
Given an unselected community plugin card is visible
When the user selects that card
Then the modal appends the navigation bar, metadata, actions, and README detail pane

Scenario: Plugin README media resolves against the repository
Test:
Filter: resolves plugin README media against repository HEAD
Given a selected plugin README contains relative and GitHub blob media URLs
When Markdown rendering completes
Then image and video sources point to raw GitHub repository content

Rule: settings-surface — Settings follows Obsidian's enabled and restricted states
Scenario: Enabled settings show Obsidian controls and plugin rows
Test:
Filter: renders enabled settings in Obsidian order with installed plugin controls
Given community plugins are enabled and one plugin is installed
When the Community plugins setting tab renders
Then restricted mode, marketplace, update, automatic check, reload, folder, search, row actions, and toggle appear in source order

Scenario: Restricted mode shows Obsidian security guidance
Test:
Filter: renders Obsidian restricted-mode disclaimer and exits from the CTA
Given community plugins are restricted
When the Community plugins setting tab renders and the user activates its CTA
Then four icon setting rows and the exact security guidance are replaced by enabled settings

Rule: marketplace-failure — Catalog failures remain recoverable
Scenario: Catalog load failure exposes retry without stale details
Test:
Filter: shows catalog load errors and retries from the modal
Given the first catalog request fails and the next request succeeds
When the user retries from the marketplace error state
Then the recovered plugin grid renders without a stale details pane

=== Codebase Context ===

Files (1):

- docs/architecture/obsidian-community-plugins-parity/spec.md

=== Task Sketch ===

Group 1 (order 1):
Scenarios: - Marketplace opens without selecting the first plugin - Missing auto-open plugin becomes a search query - Selecting a plugin opens the Obsidian detail hierarchy - Plugin README media resolves against the repository - Enabled settings show Obsidian controls and plugin rows - Restricted mode shows Obsidian security guidance - Catalog load failure exposes retry without stale details
Boundary paths: - src/renderer/builtin/CommunityPluginMarketplaceModal.ts - src/renderer/builtin/CommunityPluginsSettingTab.ts - tests/web/builtin/CommunityPluginMarketplaceModal.test.ts - tests/web/builtin/CommunityPluginsSettingTab.test.ts - docs/architecture/obsidian-community-plugins-parity/**
Test selectors: - opens marketplace as an unselected Obsidian grid - sets the search query from a missing auto-open plugin id instead of selecting the first item - selects a plugin into Obsidian detail layout - resolves plugin README media against repository HEAD - renders enabled settings in Obsidian order with installed plugin controls - renders Obsidian restricted-mode disclaimer and exits from the CTA - shows catalog load errors and retries from the modal
