# Reverse evidence from the local Obsidian bundle

This document records clean-room reconstruction evidence from the locally extracted Obsidian desktop bundle. It intentionally avoids copying large source bodies. Use it as the parity checklist before changing the reconstructed implementation.

## Source files inspected

- `work/obsidian-inspect/obsidian-app.js`
- `work/obsidian-inspect/obsidian-app.css`
- `work/obsidian-inspect/obsidian-index.html`
- `work/obsidian-inspect/obsidian-package.json`

Observed app version: `1.12.7`.

## 2026-06-26 Modal/Notice parity pass

Evidence source:

- `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js`
- `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.css`
- `/Users/cardcunningham/Projects/decode-obsidian/.agents/skills/obsidian-reverse-profile/reference/modal-notice-api.md`

Implemented or recorded parity points:

| Evidence point | Bundle evidence | Reconstructed files |
| --- | --- | --- |
| Base `Modal` creates `.modal-container > .modal-bg + .modal`, with close button, header/title, and content. The observed base class does not create `.modal-button-container`; the reconstruction currently keeps `Modal.buttonEl` as a compatibility bridge for existing built-in modal subclasses. | `tb` constructor offsets `1,075,036` to `1,075,662` | `src/ui/Modal.ts`, `src/ui/Modal.test.ts` |
| `setBackgroundOpacity()` and `setDimBackground()` only update stored fields; already-open DOM is not recalculated until the next open path. | `setBackgroundOpacity` offset `1,079,685`; `setDimBackground` offset `1,079,837` | `src/ui/Modal.ts`, `src/ui/Modal.test.ts` |
| `ConfirmationModal` adds `mod-confirmation` to the container, wires checkbox callbacks to input click events with `tabindex=-1`, and string buttons keep the modal open only when callbacks return truthy. | `nb` constructor offset `1,079,905`; `addCheckbox` offset `1,080,180`; `addButton` offset `1,080,370` | `src/ui/Modal.ts`, `src/ui/Modal.test.ts` |
| `Notice` uses a per-window `.notice-container`, `.notice > .notice-message`, text-setting semantics, hover-paused autohide, CTA buttons that hide before callback, and removes the outer container after the last notice. | `fb` constructor offset `1,089,556`; `setMessage` offset `1,090,120`; `setAutoHide` offset `1,090,170`; `addButton` offset `1,090,746`; `hide` offset `1,090,812` | `src/ui/Notice.ts`, `src/ui/Notice.test.ts` |

## 2026-06-26 Platform/Icon parity pass

Evidence source:

- `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js`
- `/Users/cardcunningham/Projects/decode-obsidian/.agents/skills/obsidian-reverse-profile/reference/platform-icon-api.md`

Implemented or corrected parity points:

| Evidence point | Bundle evidence | Reconstructed files |
| --- | --- | --- |
| Public `Platform` is a mutable singleton exported to plugins and includes enumerable capability/device fields such as `canExportPdf`, `canPopoutWindow`, `canStackTabs`, `supportsIndexedDb`, `mobileSoftKeyboardVisible`, `hasPhysicalKeyboard`, `version`, `build`, `manufacturer`, `model`, `osName`, `osVersion`, and `deviceName`. | `Yl` object offset `547,868`; plugin export table offset `254,084` | `src/platform/Platform.ts`, `src/plugin/PluginApiParity.test.ts` |
| `Platform` capability getters follow the observed formulas: PDF export requires desktop app, popout requires desktop app and desktop, stack/split/ribbon are disabled on phone, and pin sidebar requires mobile non-phone. | `Yl` getter block offset `547,868` | `src/platform/Platform.ts`, `src/plugin/PluginApiParity.test.ts` |
| `setIcon(parent, iconId)` removes the stale first child before resolving a new icon, so unknown icons must not leave an old SVG visible. | `tv` function offset `1,011,121` | `src/ui/Icon.ts`, `src/plugin/PluginApiParity.test.ts` |

## 2026-06-26 Suggest/Popover/Tooltip parity pass

Evidence source:

- `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js`
- `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.css`
- `/Users/cardcunningham/Projects/decode-obsidian/.agents/skills/obsidian-reverse-profile/reference/suggest-popover-tooltip-api.md`

Implemented or corrected parity points:

| Evidence point | Bundle evidence | Reconstructed files |
| --- | --- | --- |
| `SuggestModal` prompt input uses Android-only `enter` and otherwise `done` for `enterkeyhint`; phone prompt input containers gain `.mod-raised`. | `sb` constructor offset `1,086,682` | `src/suggest/SuggestModal.ts`, `src/suggest/SuggestModal.test.ts` |
| Common suggestion keyboard navigation registers `Ctrl-p`/`Ctrl-n` only on macOS/iOS runtimes, not globally. | `ob` constructor near `sb` offset `1,086,682`; platform guard in chooser registration | `src/suggest/SuggestModal.ts`, `src/suggest/AbstractInputSuggest.ts`, `src/suggest/SuggestModal.test.ts` |
| `PopoverSuggest.attachDom()` appends `.suggestion-container` to `activeDocument.body`; repositioning follows the shared placement helper shape with absolute positioning, `gap=5`, prevent-overlap, and left/right alignment based on direction/RTL. | `EI.attachDom/reposition` offset `1,629,847`; `Nv` placement helper offset `1,014,305` | `src/suggest/AbstractInputSuggest.ts` |
| `setTooltip()` only writes non-bottom placement, provided classes, and truthy delay data attributes. Bottom and `delay:0` do not write optional attributes, matching the observed `Ev()` helper. | `Mv/Ev` offset `1,014,305` | `src/ui/Popover.ts`, `src/ui/Popover.test.ts` |
| Array suggestions are applied synchronously, composing arrow/page/enter events do not move/choose, duplicate suggestion values select by DOM item index, and input-suggest auto-destroy polls input visibility rather than closing on outside mousedown. | `sb.updateSuggestions` offset `1,086,682`; `ob` chooser offset `1,082,066`; `SI.setAutoDestroy` via `Rv` offset `1,636,715` | `src/suggest/SuggestModal.ts`, `src/suggest/AbstractInputSuggest.ts`, `src/suggest/SuggestModal.test.ts`, `src/suggest/AbstractInputSuggest.test.ts` |
| Direct `displayTooltip()` honors a truthy `delay` option before creating the `.tooltip`, matching the observed `kv()` delay branch. | `kv` offset `1,012,596` | `src/ui/Popover.ts`, `src/ui/Popover.test.ts` |
| `HoverPopover` starts in `Showing`, creates `.popover.hover-popover` without a `.popover-content` wrapper, claims `parent.hoverPopover` in `onShow()`, calls `load()` on show, calls `onHide()`/`unload()` on hide, and keeps parent hovers alive while child hovers are active. | `PopoverState/rX` offset `2,250,020` | `src/ui/Popover.ts`, `src/ui/Popover.test.ts` |

## 2026-06-26 Component/Plugin lifecycle parity pass

Evidence source:

- `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js`
- `/Users/cardcunningham/Projects/decode-obsidian/.agents/skills/obsidian-reverse-profile/reference/component-plugin-api.md`

Implemented or corrected parity points:

| Evidence point | Bundle evidence | Reconstructed files |
| --- | --- | --- |
| `Component.load()` sets `_loaded`, calls `onload()`, then child `load()` in current order. Any truthy return from `onload()` or a child `load()` is collected into `Promise.all(...)`; it is not limited to promise-like values. | `Component.load` offset `700,815` | `src/core/Component.ts`, `src/core/Component.test.ts` |
| `Component.unload()` unloads children LIFO, registered cleanup callbacks LIFO, then calls `onunload()`. Async `onunload()` return values are not awaited. | `Component.unload` offset `701,080` | `src/core/Component.ts`, `src/core/Component.test.ts` |
| Community `Plugin.load()` overrides `Component.load()`, awaits plugin `onload()`, then starts child `load()` calls without awaiting them. `Plugin` does not define its own prototype `onunload`; it inherits the base component method. | `Plugin.load` offset `2,738,386`; inherited `Component.onunload` offset `701,259` | `src/plugin/Plugin.ts`, `src/core/Component.test.ts`, `src/plugin/PluginApiParity.test.ts` |
| `Plugin.addStatusBarItem()` adds `plugin-${manifest.id.toLowerCase().replace(/[^_a-zA-Z0-9-]/, "-")}`. This preserves `_` and replaces only the first non-matching character. | `Plugin.addStatusBarItem` offset `2,738,929` | `src/plugin/Plugin.ts`, `src/plugin/PluginApiParity.test.ts` |

## 2026-06-26 WorkspaceLeaf history/view-state parity pass

Evidence source:

- `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js`
- `/Users/cardcunningham/Projects/decode-obsidian/.agents/skills/obsidian-reverse-profile/reference/workspace-api.md`

Implemented or corrected parity points:

| Evidence point | Bundle evidence | Reconstructed files |
| --- | --- | --- |
| `WorkspaceLeaf.history` is a public object exposing `backHistory`, `forwardHistory`, `back()`, `forward()`, `go(delta)`, `pushState()`, `serialize()`, and `deserialize()`, not just a serializer facade. | `WorkspaceLeaf.history` offset `1,405,074` | `src/workspace/WorkspaceLeaf.ts`, `src/workspace/WorkspacePublicApi.test.ts` |
| `ItemView` and app navigation commands should route through `leaf.history.back()` / `leaf.history.forward()`. Legacy `leaf.goBack()` / `leaf.goForward()` remain compatibility aliases. | `ItemView` lifecycle/navigation offset `1,055,365` | `src/views/ItemView.ts`, `src/app/AppCommands.ts` |
| `WorkspaceLeaf.getViewState()` returns the plugin-facing wrapper `{ type, state }` plus available `icon/title`; `pinned` appears only when true, and `group` is not returned from this public wrapper. | `WorkspaceLeaf.getViewState` offset `1,410,913` | `src/workspace/WorkspaceLeaf.ts`, `src/workspace/WorkspacePublicApi.test.ts` |
| `Workspace.onLayoutReady()` invokes callbacks immediately once ready, but queues pre-ready callbacks as callback/plugin-context records and flushes them asynchronously after `layout-ready`. | `Workspace.onLayoutReady` offset `2,710,057`; `layout-ready` offset `2,706,464` | `src/workspace/Workspace.ts`, `src/workspace/WorkspacePublicApi.test.ts` |

## 2026-06-26 View/Workspace event parity pass

Evidence source:

- `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js`
- `/Users/cardcunningham/Projects/decode-obsidian/.agents/skills/obsidian-reverse-profile/reference/view-api.md`
- `/Users/cardcunningham/Projects/decode-obsidian/.agents/skills/obsidian-reverse-profile/reference/workspace-api.md`

Implemented or corrected parity points:

| Evidence point | Bundle evidence | Reconstructed files |
| --- | --- | --- |
| Base `View.getState()` returns `{}` and `setState()` is async no-op unless a concrete view overrides it. Base `View.getEphemeralState()` returns `{}` and `setEphemeralState()` is no-op. | `View` base offset `1,052,901` | `src/views/View.ts`, `src/views/ViewApiParity.test.ts`, `src/workspace/WorkspacePublicApi.test.ts`, `src/workspace/WorkspaceLeaf.test.ts` |
| `MarkdownView` owns its transient state explicitly instead of relying on base `View` persistence, preserving restored markdown focus/search/scroll behavior while keeping base `View` no-op. | Clean-room consequence of `View` base offset `1,052,901` | `src/views/MarkdownView.ts`, `src/views/MarkdownViewPropertyKeys.test.ts` |
| Workspace event overloads cover observed runtime events including `leaf-menu`, `tab-group-menu`, `hover-link`, `editor-selection-change`, `markdown-scroll`, `markdown-properties-menu`, `markdown-viewport-menu`, `post-processor-change`, `receive-text-menu`, `receive-files-menu`, and `window-frame-change`. | Event offsets listed in `reference/workspace-api.md` | `src/workspace/Workspace.ts` |

## 2026-06-22 parity pass

This pass used the local reverse bundle and public declaration file as the source of truth:

- `/Users/cardcunningham/Documents/Codex/2026-06-18/project-p-ts-go/work/obsidian-inspect/obsidian-app.js`
- `/Users/cardcunningham/Documents/Codex/2026-06-18/project-p-ts-go/work/obsidian-inspect/obsidian-app.css`
- `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`

Implemented parity points:

| Evidence point | Reconstructed files |
| --- | --- |
| Embedded backlinks are a child component with saved `backlinkOpts`, search, sort, collapse state and linked/unlinked sections. | `src/views/MarkdownView.ts` |
| Public `MarkdownPostProcessorContext` exposes `docId`, `sourcePath`, `frontmatter`, `addChild` and `getSectionInfo`; preview/code-block runtime context also carries private fields such as `el`, `containerEl`, `usesFrontMatter`, `replace` and `replaceCode`. | `src/markdown/MarkdownRenderer.ts`, `src/markdown/MarkdownPreviewRenderer.ts`, `src/plugin/PluginLifecycle.test.ts` |
| `MarkdownPreviewRenderer` owns the static post processor registration surface and delegates into the renderer pipeline. | `src/markdown/MarkdownPreviewRenderer.ts`, `src/plugin/Plugin.ts` |
| Plugin markdown processor registration triggers `post-processor-change` and unregisters cleanly on unload. | `src/plugin/Plugin.ts` |
| Plugin hover link source registration accepts the public `id + info` API shape while preserving the existing object form. | `src/plugin/Plugin.ts` |
| Tab selection, side dock collapse/expand and side dock width changes request layout save and resize. | `src/workspace/WorkspaceTabs.ts`, `src/workspace/WorkspaceSidedock.ts` |
| Body-level structure classes include `show-view-header`, `show-ribbon`, and initial theme application. | `src/app/AppDom.ts`, `src/app/App.ts` |
| Mobile drawer DOM class follows the bundle/CSS name `workspace-drawer`. | `src/mobile/MobileDrawer.ts` |

Additional parity points from the same pass:

| Evidence point | Bundle evidence | Reconstructed files |
| --- | --- | --- |
| Every workspace item owns `hr.workspace-leaf-resize-handle`; left-button resize delegates to parent `WorkspaceSplit.onChildResizeStart`. | `LD.constructor` offset `1,375,248`; `LD.onResizeStart` offset `1,375,659` | `src/workspace/WorkspaceItem.ts`, `src/workspace/WorkspaceSplit.test.ts` |
| Split resize uses X/width for `vertical`, Y/height for `horizontal`, minimum pane size `200px`, temporary pixel sizing during drag, and `finishResize()` writes percentage dimensions then requests layout save and resize. | `OD.onChildResizeStart` offset `1,378,576`; `OD.resizeItemsByDiff` offset `1,379,576`; `OD.finishResize` offset `1,379,831` | `src/workspace/WorkspaceSplit.ts`, `src/workspace/WorkspaceSplit.test.ts` |
| Split resize consumes drag delta from multiple siblings on the compressed side, starting nearest the handle, and applies only the consumed amount to the growing side. It is not limited to the two adjacent panes. | `OD.onChildResizeStart` offset `1,378,588`; `OD.resizeItemsByDiff` offset `1,379,588` | `src/workspace/WorkspaceSplit.ts`, `src/workspace/WorkspaceSplit.test.ts` |
| Stacked tab groups move each tab header into `.workspace-tab-container` before its leaf container, keep existing nodes ordered in place, and call `loadIfDeferred()` for stacked leaves. | `zD.updateTabDisplay` offset `1,394,767`; `t&&(s.push(u),I.loadIfDeferred())`; `r.setChildrenInPlace(s)` | `src/workspace/WorkspaceTabs.ts`, `src/workspace/WorkspacePopoutAndTabList.test.ts` |
| Sidedock collapse uses `.is-sidedock-collapsed`, width transition/hide-show semantics, workspace open class updates, ribbon `is-collapsed`, and resize handle opacity; the sidedock container is not modeled with native `hidden`. | `FD.collapse/expand` offset `1,380,627`; `i.hide()` / `i.show()`; `r.style.opacity="0"/"1"` | `src/workspace/WorkspaceSidedock.ts`, `src/workspace/WorkspaceDomStructure.test.ts` |
| Right ribbon empty state calls `rightRibbon.hide()/show()`, which toggles `.workspace-ribbon.is-hidden`; ribbon action visibility uses display toggling while keeping action buttons in DOM order. | `P0.hide/show/onChange` offset `2,662,235`; app.css `.workspace-ribbon.is-hidden` line `4437` | `src/workspace/WorkspaceSidedock.ts`, `src/workspace/WorkspaceRibbon.ts`, `src/workspace/WorkspaceDomStructure.test.ts` |
| Frame/titlebar DOM is a body-level sibling inserted before `.app-container`: `.titlebar > .titlebar-inner > .titlebar-text + .titlebar-button-container.mod-left + .titlebar-button-container.mod-right`. Body frame classes such as `is-frameless` and `is-hidden-frameless` come from frame setup, not `AppDom`. | `BD` constructor offset `1,385,259`; `titlebar-button-container mod-left/right` offset `1,385,734`; app.css `.titlebar` line `5607` | `src/app/FrameDom.ts`, `src/app/App.ts`, `src/workspace/WorkspaceDomStructure.test.ts` |
| Popout windows reuse frame/titlebar setup, add `is-popout-window`, and create `.app-container > .horizontal-main-container > .workspace`; the observed popout construction path does not create a separate `.status-bar`. | `window.open("about:blank"` offset `2,665,966`; `bZ(u), kte(u), gZ(u)`; popout app-container creation offset `2,666,115` | `src/workspace/WorkspaceWindow.ts`, `src/workspace/WorkspacePopoutAndTabList.test.ts` |
| Popout body class/style synchronization copies the main window body while preserving local popout window state (`is-frameless`, `is-focused`, `is-fullscreen`, `is-popout-window`) and frame style values such as `--zoom-factor`. | `vZ` body sync offset `2,445,308`; `n.className=i.join(" ")` offset `2,447,086`; preserved class list `pZ`; style variable list `hZ` | `src/app/BodyClasses.ts`, `src/workspace/WorkspaceWindow.ts`, `src/workspace/WorkspacePopoutAndTabList.test.ts` |
| Workspace popout creation uses `window.open("about:blank", "_blank", "popup,...")`, appends a `<base href=location.href>`, assigns `popoutWindow.app`, and inserts a `WorkspaceWindow` into `floatingSplit`. `openPopout()` returns the window, `openPopoutLeaf()` returns a passive leaf, and `moveLeafToPopout()` returns the `WorkspaceWindow` for ItemView leaves while defaulting size/zoom from the source leaf when missing. | `O0` constructor offset `2,665,966`; `openPopout/openPopoutLeaf/moveLeafToPopout` offsets `2,719,993` and `2,720,484` | `src/workspace/Workspace.ts`, `src/workspace/WorkspaceWindow.ts`, `src/workspace/WorkspacePublicApi.test.ts` |
| Body classes are split by responsibility: `obsidian-app` is App-owned, platform class is startup/platform detection, `is-focused` follows focus, and `show-view-header/show-ribbon` follow config. `main.ts` and `AppDom` should not hardcode these classes. | `obsidian-app` offset `3,666,232`; platform class offset `3,664,852`; focus tracker offset `2,448,284`; display config offsets `3,713,285` and `3,713,414` | `src/app/BodyClasses.ts`, `src/app/App.ts`, `src/main.ts`, `src/app/AppDom.ts` |
| `WorkspaceItem.setDimension` clears invalid `<= 0` or `>= 100` dimensions and otherwise writes `style.flexGrow`. | `LD.setDimension` offset `1,376,065` | `src/workspace/WorkspaceItem.ts` |
| `MarkdownRenderChild` is a `Component` child with only `containerEl`; postprocessor `addChild` must attach to a real owner Component, not an invented render context component. | `MarkdownRenderChild` offset `2,535,669`; `Component.addChild/removeChild` offsets `1,397,751`, `1,398,016`, `1,398,229`, `1,398,318` | `src/markdown/MarkdownRenderChild.ts`, `src/markdown/MarkdownRenderer.ts`, `src/markdown/RenderContext.ts` |
| Preview render cleanup removes `MarkdownRenderChild` instances whose `containerEl` no longer belongs to the current rendered sections/root. | `Gz.cleanupParentComponents` offset `2,555,285`; `Gz.clear` offset `2,538,409`; `Gz.onRender` offset `2,543,037` | `src/markdown/MarkdownRenderer.ts`, `src/plugin/PluginLifecycle.test.ts` |
| `getSectionInfo(el)` returns only `text`, `lineStart`, and `lineEnd`; `text` is the whole last markdown text. | `Gz.getSectionInfo` offset `2,539,066` | `src/markdown/MarkdownRenderer.ts`, `src/plugin/PluginLifecycle.test.ts` |
| `mobile-drawer` is a `WorkspaceParent`, not an external service DOM node; mobile runtime uses left/right drawer variants while desktop ignores `mobile-drawer` layout nodes. | `WD extends ID` offset `1,414,134`; `type = "mobile-drawer"` offset `1,414,204`; `_D` offset `1,425,587`; `GD` offset `1,427,616`; deserialize branch offset `2,707,727` | `src/mobile/MobileDrawer.ts`, `src/mobile/MobileWorkspace.ts`, `src/workspace/Workspace.ts`, `src/workspace/WorkspaceLayout.ts`, `src/workspace/WorkspaceLayoutSerializer.ts`, `src/workspace/WorkspaceLayoutPersistence.test.ts` |
| `mobile-drawer` serialization writes `children`, always writes `currentTab`, and writes `pinned: true` only when pinned; no `side` is stored in layout. | `WD.serialize` offset `1,419,834`; `WD.selectTabIndex` offset `1,423,656`; `WD.setPinned` offset `1,425,275` | `src/mobile/MobileDrawer.ts`, `src/workspace/WorkspaceLayoutSerializer.ts` |
| `WorkspaceTabs.serialize` only writes `currentTab` when `currentTab > 0`; `selectTabIndex` saves/resizes only when the selected tab changes; `setStacked` requests layout update rather than directly saving/resizing. | `zD.serialize` offset `1,393,995`; `zD.selectTabIndex` offset `1,394,158`; `zD.setStacked` offset `1,393,726` | `src/workspace/WorkspaceTabs.ts`, `src/workspace/WorkspaceSplit.test.ts` |
| Mobile workspace top-level DOM is `[leftDrawer, rootSplit, rightDrawer]`; left ribbon is moved into left drawer, loses `workspace-ribbon`, keeps `side-dock-ribbon mod-left`, gains `workspace-drawer-ribbon`, and is placed before drawer header/tab container. | mobile top-level layout offset `2,704,664`; left drawer ribbon handoff offset `1,424,361`; CSS `.workspace-drawer-ribbon` app.css byte `552856` | `src/workspace/Workspace.ts`, `src/mobile/MobileDrawer.ts`, `src/workspace/WorkspaceLayoutPersistence.test.ts` |

Validation run after this pass:

```text
bunx vitest run src/plugin/PluginLifecycle.test.ts
bunx tsc --noEmit
bunx oxlint -c oxlint.json src --quiet
```

Additional validation:

```text
bunx vitest run src/plugin/PluginLifecycle.test.ts src/workspace/WorkspaceLayoutPersistence.test.ts src/workspace/WorkspaceSplit.test.ts
bunx tsc --noEmit
bunx oxlint -c oxlint.json src --quiet
```

Mobile drawer validation used the same command and covers:

```text
mobile runtime serializes left/right as mobile-drawer
mobile runtime restores mobile-drawer children/currentTab/pinned
desktop runtime ignores mobile-drawer layout nodes
mobile runtime top-level DOM omits ribbon siblings
left mobile drawer owns left ribbon with workspace-drawer-ribbon class
```

## Bundle symbol map

The bundle is minified, but its public export table and constructor bodies expose the main architecture names:

| Bundle symbol | Reconstructed name | Role |
| --- | --- | --- |
| `Tte` | `App` | top-level application object |
| `wte` | app DOM shell | creates app container, workspace host, status bar |
| `p0` | `ViewRegistry` | maps view types and file extensions to view creators |
| `H0` | `Workspace` | owns layout tree, sidebars, ribbons, active leaf, layout persistence |
| `LD` | `WorkspaceItem` | base workspace tree item |
| `ID` | `WorkspaceParent` | workspace item with children |
| `OD` | `WorkspaceSplit` | vertical/horizontal split container |
| `FD` | `WorkspaceSidedock` | left/right sidebar split |
| `zD` | `WorkspaceTabs` | tab group container |
| `jD` | `WorkspaceLeaf` | tab/leaf that owns one current view |
| `P0` | `WorkspaceRibbon` | side ribbon actions |
| `Kg` | `View` | base view, creates `.workspace-leaf-content` |
| `Yg` | `ItemView` | view with `.view-header` and `.view-content` |
| `MD` | `FileView` | file-backed item view |
| `OX` | `EditableFileView` | editable file view with rename/title behavior |
| `BX` | `TextFileView` | text file view with save/load/dirty tracking |
| `W6` | `MarkdownView` | default markdown file view with source/preview modes |
| `G0` | `Plugin` | public community plugin base class |
| `i2` | internal plugin wrapper | buffers core plugin registrations and applies them on enable |
| `o2` | internal plugin manager | loads core plugins and enables defaults/user config |
| `tD` | empty view | new-tab empty state view |
| `eD` | deferred view | placeholder for deferred/late-loaded view |
| `nD` | unknown view | fallback for unknown view types |

## Real startup chain

The real desktop `index.html` loads CSS, bundled libraries, and `app.js`. The final desktop bootstrap does roughly this:

```text
Electron asks main process for vault id/path
 -> create FileSystemAdapter for the vault path
 -> ready(() => window.app = new App(adapter, vaultId))
```

Inside `App`:

```text
constructor:
  viewRegistry = new ViewRegistry()
  keymap/scope/commands/hotkeys/dragManager
  dom shell
  customCss/renderContext/secretStorage/cli

initializeWithAdapter:
  vault = new Vault(adapter)
  workspace = new Workspace(app, dom.workspaceEl)
  fileManager/statusBar/metadataCache/setting/foldManager
  internalPlugins = new InternalPluginManager(app)
  plugins = new CommunityPluginManager(app)
  load all core plugin definitions
  enable core plugins based on config/defaultOn
  load vault/cache/workspace layout
  run opening behavior
```

Important parity point: `ViewRegistry` exists before `Workspace`. `Workspace` relies on it when leaves create views.

## App DOM shell

The real DOM shell creates:

```text
body
  .app-container
    .horizontal-main-container
      .workspace
    .status-bar
```

The reconstructed app should not flatten this into only `.app-container -> .workspace`. CSS and desktop frame behavior assume this shell.

## ViewRegistry evidence

Real `ViewRegistry` stores:

```text
viewByType
 typeByExtension
```

Real methods:

```text
registerView(type, creator)
unregisterView(type)
registerExtensions(extensions, type)
unregisterExtensions(extensions)
registerViewWithExtensions(extensions, type, creator)
getViewCreatorByType(type)
getTypeByExtension(extension)
isExtensionRegistered(extension)
```

The constructor registers base file views directly, including MarkdownView with markdown extensions.

Parity point: base file view registration belongs close to `ViewRegistry`; feature/sidebar views mostly come from core plugins.

## WorkspaceLeaf evidence

Real `WorkspaceLeaf` owns:

```text
containerEl: .workspace-leaf
tabHeaderEl
tabHeaderInnerIconEl
tabHeaderInnerTitleEl
tabHeaderStatusContainerEl
tabHeaderCloseEl
view
_empty
history
pinned/group/working state
resizeObserver
```

Real behavior:

```text
constructor:
  create leaf container and tab header
  create empty view
  open empty view immediately

openFile(file, openState):
  type = viewRegistry.getTypeByExtension(file.extension)
  if current FileView accepts extension, reuse current type
  state.file = file.path
  setViewState({ type, state, active, group }, ephemeralState)

setViewState(state, ephemeralState):
  if type changed, ask ViewRegistry for creator
  if no creator, use unknown view fallback
  open the view
  call view.setState()
  maybe close if state requested close
  set active leaf
  apply group/ephemeral state
  update header
  record history/layout
```

Parity point: `WorkspaceLeaf` is the only correct place to instantiate/open views. Do not mount core views directly from app bootstrap.

## Empty/deferred/unknown views

Real special views:

```text
empty view:
  type = "empty"
  display = New tab
  shows actions such as create new file, go to file, close
  accepts drops

deferred view:
  keeps viewType/icon/title/state
  rerenders itself when inserted/clicked

unknown view:
  extends empty view
  shows unknown pane message for missing view type
  can close one/all panes of that unknown type
```

Parity point: a runnable reconstruction needs at least empty and unknown views. Deferred view can be simplified at first, but the architectural slot should exist.

## Workspace layout evidence

Real layout persistence:

```text
readWorkspaceFile()
loadLayout()
setLayout(layout)
getLayout()
saveLayout()
changeLayout(layout)
deserializeLayout(node, side)
```

Layout object includes:

```text
main
left
right
left-ribbon
floating?
active?
lastOpenFiles?
```

Real `setLayout` behavior:

```text
layoutReady = false
if main/left/right/floating exists: deserialize each tree
if no main: create root split -> tabs -> leaf
if no left/right: create sidedocks and collapse as appropriate
attach children to workspace container in desktop order:
  leftRibbon, leftSplit, rootSplit, rightSplit, rightRibbon
set active leaf from layout.active when possible
load visible deferred leaves
layoutReady = true
trigger layout changes
```

Parity point: current reconstruction must implement real layout restore, not only emit a `layout-restore-request` event.

## Workspace side leaf evidence

Real `ensureSideLeaf(type, side, options)`:

```text
find existing leaves of type
if none, get left/right side leaf
optionally load deferred leaf
set view state if state provided or type differs
optionally reveal leaf
optionally set active leaf
return leaf
```

Core plugins use this for file explorer/search/backlinks/outline side panes.

## Core plugin system evidence

Real core plugin manager uses a wrapper object around each internal plugin definition.

Core plugin wrapper responsibilities:

```text
init(): call plugin definition init(app, wrapper)

registration buffer before enable:
  commands[]
  ribbonItems[]
  mobileFileInfo[]
  hasStatusBarItem
  views{}

enable(userInitiated):
  add buffered commands to app.commands
  add ribbon buttons to workspace.leftRibbon
  add status bar item if requested
  register buffered views to app.viewRegistry
  call instance.onEnable(app, wrapper)
  call instance.onUserEnable(app) if userInitiated
  load component lifecycle
  save config

disable(userInitiated):
  call onDisable/onUserDisable
  remove commands/ribbon/status bar
  unregister views
  detach leaves of view type when user disabled
  unload lifecycle
  save config
```

Real internal plugin wrapper API:

```text
registerViewType(type, creator)
registerGlobalCommand(command)
registerRibbonItem(title, icon, callback)
registerStatusBarItem()
registerMobileFileInfo(renderCallback)
addSettingTab(tab)
registerCliHandler(...)
loadData()
saveData(data)
deleteData()
```

Parity point: do not model core plugins as normal community `Plugin` instances. Obsidian has a distinct internal wrapper API.

## Core plugin defaults

Real core plugin default list observed:

```text
file-explorer
global-search
switcher
graph
backlink
outgoing-link
tag-pane
page-preview
daily-notes
templates
note-composer
command-palette
slash-command
editor-status
starred
markdown-importer
zk-prefixer
random-note
outline
word-count
slides
audio-recorder
workspaces
file-recovery
publish
sync
```

Enable logic:

```text
read core-plugins config
if old array format, migrate to object map
if config says enabled, enable
if config absent for a plugin, enable when defaultOn is true
save config
```

## Public Plugin API evidence

Real public plugin base exposes:

```text
addRibbonIcon(icon, title, callback)
addStatusBarItem()
addCommand(command)
removeCommand(id)
addSettingTab(tab)
registerView(type, creator)
registerHoverLinkSource(id, source)
registerExtensions(extensions, type)
registerMarkdownPostProcessor(processor, sortOrder?)
registerMarkdownCodeBlockProcessor(language, processor, sortOrder?)
registerBasesView(type, registration)
registerEditorExtension(extension)
registerCodeMirror(...)
registerObsidianProtocolHandler(action, handler)
registerEditorSuggest(suggest)
registerCliHandler(...)
loadData()
saveData(data)
loadCSS()
```

Parity point: community plugin API and internal core plugin API are related but not identical.

Observed public plugin API details:

```text
Plugin.addCommand at app.js offset 2739159 mutates command.id to manifest.id + ":" + id and command.name to manifest.name + ": " + name, then registers it with app.commands
Plugin.addRibbonIcon at app.js offset 2738699 calls workspace.leftRibbon.addRibbonItemButton, returns a clickable-icon side-dock-ribbon-action button under .workspace-ribbon.side-dock-ribbon.mod-left > .side-dock-actions, passes MouseEvent to the callback, and removes the ribbon action during unload
Plugin.addStatusBarItem at app.js offset 2738930 calls app.statusBar.registerStatusBarItem, creates a status-bar-item under .app-container > .status-bar, adds plugin-${manifest.id} class, and removes the element during unload
Component.registerEvent at app.js offset 701554 registers eventRef.e.offref(eventRef) for unload cleanup
Component.registerDomEvent at app.js offset 701643 immediately attaches addEventListener and registers matching removeEventListener cleanup for unload
```

Observed command manager details:

```text
CommandManager addCommand wraps editorCallback/editorCheckCallback into command.checkCallback, using workspace.activeEditor as the editor/view source and filtering preview mode, active inline title, and active metadata container before invoking editor callbacks
CommandManager listCommands filters through checkCallback(true) using normal JavaScript truthiness; false, undefined, and null hide the command, while Promise-like objects are not specially rejected and therefore count as truthy
CommandManager executeCommandById returns false when the command id is missing, otherwise delegates to executeCommand
CommandManager executeCommand sets app.lastEvent to the explicit event argument or null, calls checkCallback(false) or callback synchronously, returns true after the call when no exception is thrown, and does not await promise-returning callbacks
HotkeyManager onTrigger is installed as a root scope handler, matches baked hotkeys against the normalized keymap event, calls app.commands.executeCommand(command) without forwarding the KeyboardEvent, and therefore hotkey-triggered commands clear app.lastEvent to null
HotkeyManager does not prefilter through app.commands.listCommands(); a matching command whose checkCallback(true) would hide it from the command palette can still consume a hotkey if executeCommand(command) succeeds
Command palette selection sets app.lastEvent to the choosing MouseEvent/KeyboardEvent, calls the raw command helper, then records the selected command id as recent
HotkeyManager getHotkeys returns user custom hotkeys, getDefaultHotkeys returns command default hotkeys, and command palette renders custom hotkeys first with default hotkeys as fallback using Obsidian's modifier/key display style
App loadLocalStorage/saveLocalStorage namespace keys with appId + "-" + key; command palette recent commands therefore persist under app-scoped recent-commands and are capped at 100 entries
Command palette pinned settings render pinned command rows as mobile-option-setting-item entries with mobile-option-setting-item-name, clickable-icon SVG lucide-x removal, and clickable-icon mobile-option-setting-drag-icon SVG lucide-menu drag reorder controls
```

Observed SuggestModal / FuzzySuggestModal details:

```text
SuggestModal uses prompt DOM classes: prompt, prompt-input-container, prompt-input, prompt-input-cta, search-input-clear-button, prompt-results, prompt-instructions
SuggestModal registers ArrowUp, ArrowDown, PageUp, PageDown, Home, End, and Enter on the modal scope rather than on prompt input DOM keydown; common Tab behavior comes from Modal's tabFocusContainerEl instead of a generic SuggestModal binding
SuggestModal selectSuggestion updates app.keymap modifiers from the choosing MouseEvent/KeyboardEvent before closing and invoking onChooseSuggestion
SuggestChooser renders suggestion-item rows, tracks is-selected, wraps setSelectedItem indexes, scrolls selected rows for keyboard/null selection changes, and calls owner.onSelectedChange(value, event)
Suggestion click/auxclick prevents default, selects the clicked row, then uses the selected item
FuzzySuggestModal trims the query, gathers fuzzy matches from getItems/getItemText, sorts by fuzzy score, and delegates chosen fuzzy items to onChooseItem
```

Observed Modal details:

```text
Modal base DOM uses modal-container, modal-bg, modal, modal-close-button mod-raised clickable-icon, modal-header, modal-title, modal-content
Modal Escape is registered on scope and onEscapeKey closes only when event.defaultPrevented is false
Modal onClickOutside likewise closes only when event.defaultPrevented is false
Modal exposes setBackgroundOpacity(value) and setDimBackground(value) to configure the modal backdrop before or during display
```

Observed QuickSwitcher details:

```text
Quick switcher core plugin id is switcher, defaultOn is true, registers ribbon item "Open quick switcher" with lucide-file-search, and registers switcher:open with lucide-navigation plus Mod+O
Quick switcher keeps a single active modal and clears it through setCloseCallback after close
Quick switcher modal instructions include navigate, open, Mod+Enter new tab, Mod+Alt+Enter open to the right, Shift+Enter create, and Escape dismiss
Quick switcher selection uses Keymap.isModEvent(event) to choose the workspace leaf mode before opening files or created notes
Quick switcher empty query candidates come from workspace.getRecentFiles via RecentFileTracker, capped at the tracker default recent count, while non-empty queries search files through fuzzy matching
Quick switcher create rows are offered for non-empty no-match input through the null/no-suggestion row; showExistingOnly suppresses unresolved link suggestions but does not suppress creation
Quick switcher markdown file rows display the path without the .md extension as the title while keeping the full path in suggestion-note
Quick switcher visible files include markdown and canvas/base non-attachments by default, include attachments when showAttachments is true, and include every file type when showAllFileTypes is true
Quick switcher unresolved candidates come from metadataCache.unresolvedLinks when existing-only mode is disabled, render as a suggestion-flair with lucide-file-plus / notCreatedYet, and open through workspace.getLeaf(mode).openLinkText(linktext, sourcePath, { active: true })

Workspace linked file views: FileView.setState sets done=syncState when !state.sync and layout/history changed; syncState uses workspace.getGroupLeaves(group), where bundle evidence only collects leaves whose leaf.group matches the group. Markdown receiveSyncState syncs file plus eState when file differs, or only ephemeral state when file is the same.

Workspace active-file events: original activeLeafEvents triggers active-leaf-change with the current leaf, then compares lastActiveFile with getActiveFile and triggers file-open only when the active file changes. FileView file changes now request active leaf events only when the changed view's leaf is the active leaf, avoiding background leaf noise. onLayoutReady(callback) now mirrors the original one-shot callback queue: callbacks registered before readiness are flushed once after layout-ready; callbacks registered after readiness run immediately.
Workspace view-state noise: the inspected bundle has no `view-state-change` workspace event string and no equivalent dedicated view-state event; current reconstruction no longer emits that reconstruction-only event from WorkspaceLeaf.setViewState or MarkdownView.setMode. Plugins should rely on original-backed `layout-change`, `active-leaf-change`, `file-open`, and layout save requests instead.

Workspace popouts: Workspace.getLeaf("window") delegates to openPopoutLeaf; bundle evidence shows openPopout creates WorkspaceWindow/O0, then creates a WorkspaceLeaf wrapped in WorkspaceTabs, producing floating -> window -> tabs -> leaf. WorkspaceWindow constructor triggers window-open, and WorkspaceWindow.close triggers window-close.

Workspace tree mutation: WorkspaceItem.detach only delegates to parent.removeChild. WorkspaceParent.removeChild is the normalization point: empty parents recursively remove themselves from their parent, and a single remaining child is promoted when allowSingleChild is false. WorkspaceTabs sets allowSingleChild=true, records the last stacked tab group when its final child is removed, and root emptiness is repaired later by Workspace.updateLayout creating a new WorkspaceTabs + WorkspaceLeaf.

Workspace leaf drag/drop: leaf tab headers call Workspace.onDragLeaf on dragstart and only write an empty text/plain payload to dataTransfer. onDragLeaf registers window-level dragover/drop/dragend handlers while the tab is being dragged. Obsidian does not expose or trigger a leaf-drop event for tab movement. Center drops into WorkspaceTabs insert or reorder the source leaf using the tab insert location; left/right edge drops map to vertical split insertion, and top/bottom edge drops map to horizontal split insertion. Center drops onto non-tab leaf targets swap source and target leaves.

Global drag manager: Obsidian's internal dragManager writes text/plain and text/uri-list for file/link drags, tracks an internal draggable object, applies is-grabbing during drag, and runs handleDrop callbacks in hover/drop phases. ItemView registers its container with dragManager.handleDrop and delegates accepted drops to leaf.handleDrop only for the header, canDropAnywhere, or the platform open-in-leaf modifier. WorkspaceLeaf.handleDrop opens file drags with openFile and link drags with openLinkText, returning an Open in this tab drop result.
```

## MarkdownView evidence

Real `MarkdownView` is not just a markdown preview component. It extends the text-file view chain and owns:

```text
editMode
previewMode
sourceMode
metadataEditor
inlineTitleEl
backlinksEl
modeButtonEl
currentMode
modes registry
scope
```

State includes:

```text
mode
source
backlinks
backlinkOpts
```

Ephemeral state handles:

```text
rename focus
subpath -> line/start/end location
scroll
current mode ephemeral state
```

Parity point: first runnable reconstruction can simplify CodeMirror/properties/backlinks, but `MarkdownView` must remain a file-backed multi-mode view with state/ephemeral handling.

## CSS structure evidence

Observed structural classes from real CSS:

```text
.app-container
.horizontal-main-container
.workspace
.workspace-ribbon
.workspace-split
.workspace-split.mod-vertical
.workspace-split.mod-horizontal
.workspace-split.mod-root
.workspace-split.mod-left-split
.workspace-split.mod-right-split
.workspace-tabs
.workspace-tab-header-container
.workspace-tab-header-container-inner
.workspace-tab-container
.workspace-leaf
.workspace-leaf-content
.view-header
.view-header-left
.view-header-title-container
.view-header-title-parent
.view-header-title
.view-actions
.view-content
.markdown-source-view
.markdown-preview-view
.markdown-rendered
.status-bar
```

Important CSS behavior:

```text
left/right side split hides view headers
workspace-leaf-content[data-type='markdown'] removes view-content padding and overflow
Markdown source/preview own their scrolling
ribbon has left/right mod classes and participates in desktop frame spacing
```

## Current reconstruction gaps to fix first

1. Add an `AppDom` shell matching real `.app-container -> .horizontal-main-container -> .workspace` plus `.status-bar`.
2. Move base file view registration closer to `ViewRegistry` and keep feature views in core plugins.
3. Rework `WorkspaceLeaf` toward real behavior: tab header ownership, empty view by default, unknown fallback, header updates, state/ephemeral/history hooks.
4. Rework `WorkspaceTabs` so it manages leaf tab headers instead of creating static headers from incomplete view state.
5. Implement `Workspace.setLayout/getLayout/saveLayout/loadLayout/deserializeLayout` instead of only triggering restore events.
6. Introduce an internal plugin wrapper API separate from public `Plugin`.
7. Make core plugins register buffered commands/views/ribbons/status bar items, then apply them on enable.
8. Expand `EmptyView` into the real new-tab empty state pattern.
9. Keep `MarkdownView` as a file-backed mode view; avoid turning it into a bare markdown renderer.
10. Only after the above, add a runnable browser/Electron bootstrap that exercises the real chain.

## Clean-room rule

Implementation should be written from the observed architecture and behavior, not by copying minified Obsidian code bodies.

## Workspace layout evidence

Source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse target names:

```text
H0 = Workspace
LD = WorkspaceItem
ID = WorkspaceParent
OD = WorkspaceSplit
FD = WorkspaceSidedock
zD = WorkspaceTabs
jD = WorkspaceLeaf
WD = MobileDrawer
_D / GD = left / right mobile drawers
L0 = WorkspaceRoot
I0 = WorkspaceFloating
O0 = WorkspaceWindow
```

Observed layout tree:

```text
desktop workspace DOM: leftRibbon, leftSplit, rootSplit, rightSplit, rightRibbon
mobile workspace DOM: left drawer, rootSplit, right drawer
desktop leaf path: WorkspaceSplit -> WorkspaceTabs -> WorkspaceLeaf
mobile drawer can directly hold WorkspaceLeaf and moves active leaf DOM into workspace-drawer-active-tab-content
main layout deserializes to WorkspaceRoot with vertical direction
desktop left/right layouts deserialize to WorkspaceSidedock with horizontal direction
mobile left/right layouts deserialize to MobileDrawer
```

Observed serialization fields:

```text
Workspace.getLayout: main, left, right, left-ribbon, optional floating, optional active
WorkspaceItem: id, type, optional dimension
WorkspaceParent: children
WorkspaceSplit: direction
WorkspaceSidedock: width; collapsed only when true
WorkspaceTabs: currentTab only when greater than 0; stacked only when true
WorkspaceLeaf: state; pinned only when true; group only when present
MobileDrawer: currentTab; pinned only when true; children; no collapsed persistence observed
```

Observed DOM classes:

```text
workspace-leaf-resize-handle
workspace-split mod-vertical / mod-horizontal
workspace-split mod-root
workspace-split mod-sidedock mod-left-split / mod-right-split
workspace-sidedock-empty-state
workspace-tabs
workspace-tab-header-container
workspace-tab-header-container-inner
workspace-tab-container
workspace-tab-header-new-tab
workspace-tab-header-tab-list
workspace-leaf
workspace-tab-header tappable
workspace-leaf-content
empty-state
empty-state-container
empty-state-title
empty-state-action-list
workspace-drawer
workspace-drawer-inner
workspace-drawer-backdrop
workspace-drawer-header
workspace-drawer-tab-container
workspace-drawer-tab-options
workspace-drawer-active-tab-content
```

Current reconstruction parity:

```text
WorkspaceLayoutSerializer omits default tabs.currentTab when it is 0
WorkspaceLayoutSerializer omits WorkspaceSidedock.collapsed unless it is true
MobileDrawer layout serialization keeps currentTab and pinned but does not persist collapsed
Workspace.getSideLeaf creates direct WorkspaceLeaf children for MobileDrawer instead of wrapping them in WorkspaceTabs
Workspace.getSideLeaf does not select newly created MobileDrawer leaves by default; Workspace.revealLeaf selects and expands direct drawer leaves
```

## Markdown preview renderer section evidence

Reverse target names:

```text
MarkdownPreviewSection / qz
MarkdownPreviewRenderer / Gz
```

Observed `MarkdownPreviewSection` shape:

```text
plain section state object, not Component
el
rendered
html
start / end positions
height
shown
lines
computed
highlightRanges
level
headingCollapsed
usesFrontMatter
```

Observed section behavior:

```text
constructor creates a div-backed section
render() parses cached html into DOM
render() adds an el-${tagName} class from the first rendered child
resetCompute() clears computed layout state and cached highlight rects
setCollapsed() toggles collapsed section state/class
```

Observed `MarkdownPreviewRenderer` shape:

```text
sections
asyncSections
recycledSections
rendered callback array
pusherEl
sizerEl
header / footer
set()
clear()
queueRender()
onRender()
updateVirtualDisplay()
getSectionInfo(el)
cleanupParentComponents()
onRendered(callback)
```

Current reconstruction parity:

```text
MarkdownPreviewSection is now a plain section model instead of a MarkdownRenderChild
MarkdownPreviewSection defaults match qz for used=true and level=0
MarkdownPreviewRenderer collects block-level preview sections from rendered markdown DOM
MarkdownPreviewRenderer records heading section level from rendered h1-h6 blocks
MarkdownPreviewRenderer adds heading-collapse-indicator collapse-indicator collapse-icon to heading sections
MarkdownPreviewRenderer applies heading fold state by hiding sections below collapsed headings until the next same-or-higher heading
getSectionInfo(el) maps DOM back to lineStart / lineEnd
static MarkdownRenderer.render does not own preview section lookup; preview rendering passes the section lookup into the postprocessor context
public postprocessor context stays limited to docId, sourcePath, frontmatter, addChild, and getSectionInfo
private preview postprocessor context includes preview-owned containerEl, el, displayMode, usesFrontMatter, and replace(source)
private code block replaceCode flows through context.getSectionInfo plus context.replace instead of editing vault files directly
postprocessors can register MarkdownRenderChild children and stale children are cleaned after rerender
rendered is modeled as a queued completion callback array; onRendered(callback) registers callbacks while a render is pending and runs immediately when idle
MarkdownPreviewRenderer tracks frontmatter and cssClasses state
previewEl CSS classes are derived only from case-insensitive cssclasses frontmatter, with whitespace-containing values filtered out
cssclass and tags do not contribute previewEl classes at render time
post-processor-change in MarkdownReadingMode triggers renderer.rerender(true)
renderer.rerender(true) clears non-ui section DOM/rendered state, resets lastText, and queues render
virtual display fields exist: viewportHeight, renderExtra, renderExtraMinPx, addBottomPadding, topSpace
updateVirtualDisplay computes a progressive render window from scrollTop, viewportHeight, renderExtra, and renderExtraMinPx
updateVirtualDisplay estimates section positions from measured height/computed values and average fallback height
updateVirtualDisplay mounts only shown sections in the active window, with pusher.marginBottom representing skipped height before the first mounted section
updateVirtualDisplay sets sizerEl.minHeight to the estimated total document height
updateVirtualDisplay expands the mounted range to preserve non-collapsed selections spanning section DOM
updateVirtualDisplay falls back to mounting every section when progressiveRender is disabled, while hidden sections keep display:none
lastScroll tracks virtual render scrollTop, while lastAppliedScrollLine records line-oriented applyScroll calls in the reconstruction
scrolling distinguishes programmatic scroll from user scroll notification
updateSearchQuery builds highlightRanges from rendered section text offsets
highlightRanges use section/start/end/active plus lazy rects cache
renderHighlights appends sizerEl > .search-highlight > div[.is-active] overlay rectangles
renderHighlights uses cached rects when present, otherwise creates DOM Ranges from text offsets and reads getClientRects
applyScroll highlight remains the .is-flashing path and does not create highlightRanges
list fold indicators are li > .list-collapse-indicator.collapse-indicator.collapse-icon
list fold state is stored on li.is-collapsed and does not affect section.shown
list fold click toggles li collapse, resets the containing section compute/highlight rect cache, queues render, and notifies owner.onFoldChange()
getFoldInfo records list folds as {from,to} using li[data-line] relative to the section start line
applyFoldInfo restores heading/list folds from fold.from values after render and queues render without owner fold notification
nested list rendering now writes li[data-line] and emits nested ul children for foldable list items
checklist parsing follows the bundle regex ^\[(.)][ \t], stores the raw single-character marker as data-task, and treats only a space marker as unchecked
checklist DOM uses li.task-list-item, li.is-checked for non-space markers, input.task-list-item-checkbox[type=checkbox], and matching data-line on both li and input
checkbox click is delegated from MarkdownPreviewRenderer, resolves input[data-line] against the containing section start line, and only toggles the marker character in the source markdown
when MarkdownPreviewRenderer is owned by MarkdownView, checklist clicks are routed to the owner edit path so TextFileView data, editor state, preview renderer text, and scheduled save stay in sync
task list parents with child lists still receive list-collapse-indicator before the checkbox because list fold decoration prepends after checklist DOM render
```

Remaining parity gap:

```text
Real Gz has a more exact measured/estimated height feedback loop.
Checklist DOM/source-toggle behavior is reconstructed; the real bundle also patches cached section HTML for immediate visual reuse, while this reconstruction syncs through the normal MarkdownView rerender path.
```

Validation command used for this slice:

```text
bunx vitest run src/markdown/MarkdownPreviewRenderer.test.ts src/views/MarkdownViewPropertyKeys.test.ts src/plugin/PluginLifecycle.test.ts src/workspace/WorkspaceLayoutPersistence.test.ts src/workspace/WorkspaceSplit.test.ts && bunx tsc --noEmit && bunx oxlint -c oxlint.json src --quiet
```

## MarkdownView mode DOM and properties evidence

Source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse target names:

```text
W6 = MarkdownView
j6 = source/edit mode
oZ = source/edit mode base
fq = preview/reading mode
Gz = MarkdownPreviewRenderer
tO = metadata editor
iZ = public editor wrapper around the CodeMirror view
BX = TextFileView-style save/load base class
```

Observed mode object model:

```text
W6 constructor creates modes = {}, editMode = registerMode(new j6(view)), previewMode = registerMode(new fq(view)), then chooses currentMode from vault defaultViewMode
j6 has type "source"
fq has type "preview"
live preview is not a third MarkdownView mode object; it is source mode state
oZ initializes sourceMode from !app.vault.getConfig("livePreview")
oZ.getDynamicExtensions uses !sourceMode as the live-preview flag, toggles is-live-preview, writes editorLivePreviewField, and mounts the livePreviewPlugin
W6.setState reads state.source and toggles editMode.sourceMode when the boolean does not match
W6.sourceMode is a public compatibility object containing the CodeMirror editor; editMode.sourceMode is the raw-source boolean
```

Observed shared DOM nodes:

```text
inlineTitleEl is created as inline-title without an initial parent
metadataEditor.containerEl is created by metadata editor without an initial parent
backlinksEl is created as embedded-backlinks, hidden immediately, and starts without an initial parent
current mode show() performs the first real mount of shared nodes
```

Observed source mode behavior:

```text
j6 is backed by a CodeMirror 6-shaped EditorView created by the oZ source base
j6.show() mounts metadataEditor.containerEl, inlineTitleEl, and backlinksEl into the source editor sizer
final source order keeps inlineTitleEl before metadataEditor.containerEl
j6.hide() hides the editor but does not detach these shared nodes
source/live preview state changes do not change top-level data-mode, which remains source
source editor updates with doc changes call view.requestSave(), requestSaveFolds(), and requestOnInternalDataChange()
W6.onInternalDataChange reads currentMode.get(), updates text data, refreshes quick preview/frontmatter
```

Observed preview mode behavior:

```text
fq constructor creates renderer header and footer sections
fq.show() appends inlineTitleEl and metadataEditor.containerEl to renderer.header.el
fq.show() appends backlinksEl to renderer.footer.el
fq.hide() hides the preview container but does not detach shared nodes
previewEl has markdown-preview-view markdown-rendered
```

Observed mode and property rules:

```text
W6.getState stores mode, source, backlinks, and backlinkOpts
W6.setMode updates data-mode to source or preview
W6.setState uses state.mode and state.source to restore mode plus source/live-preview state
W6.setMode saves when leaving source, saves folds, hides current mode, shows next mode, calls next.set(data,false), then restores scroll/folds and updates buttons/data-mode
W6.getViewData returns currentMode.get()
W6.setViewData sets every mode on clear/full load, sets only current mode for ordinary updates, and reloads frontmatter
BX.requestSave marks the view dirty and debounces save; BX.save writes getViewData() through vault.modify
onLoadFile sets inline title, delegates to BX load, then updates backlinks
default config is livePreview:true and defaultViewMode:"source"
canShowProperties is true only when propertiesInDocument is visible and current mode is not raw source
preview updatePropertiesInDocument toggles renderer.previewEl show-properties when propertiesInDocument is not hidden
source editor show-properties class is stricter and follows propertiesInDocument visible
metadata editor synchronizes frontmatter content, but mode/config decide whether it is usable as properties UI
```

Observed editor/plugin extension rules:

```text
iZ wraps the CodeMirror view and provides the public editor API: getValue, setValue, getLine, replaceSelection, replaceRange, setSelection, transaction, focus, undo, and redo
W6.editor getter returns editMode.editor
editorEditorField exposes the underlying CodeMirror EditorView to editor extensions
editorInfoField exposes MarkdownFileInfo, whose public shape is app, file, and optional editor
editorViewField is deprecated and mapped directly to editorInfoField
editor focus sets app.workspace.activeEditor to the owning MarkdownView
Plugin.registerMarkdownPostProcessor delegates to Gz.registerPostProcessor and triggers workspace post-processor-change on register/unregister
fq listens to post-processor-change and calls renderer.rerender(true)
Plugin.registerEditorExtension delegates to workspace.registerEditorExtension
source mode consumes workspace editorExtensions through dynamic CodeMirror extensions
registerCodeMirror is a no-op compatibility shim in the inspected bundle
editor-change and editor-selection-change pass the public editor wrapper plus owner view
editor-menu passes menu, editor, and owner view
markdown-viewport-menu is fired for preview/source gutters with the mode string
no dedicated public mode-change event was found; mode is exposed through leaf view state
```

Observed public Editor API evidence:

```text
obsidian.d.ts exports Editor as an abstract class, not just a TypeScript interface
iZ.getValue reads cm.state.doc.toString()
iZ.setValue replaces the full CM document
iZ.getLine, lineCount, and lastLine use the CM document line model with 0-indexed public lines
iZ.getSelection reads the main selection text
iZ.getRange converts EditorPosition objects to offsets and slices the document
iZ.replaceSelection and replaceRange dispatch CM changes and accept an optional origin/userEvent
iZ.getCursor supports from, to, anchor, and head; default is head
iZ.listSelections returns [{anchor, head}]
iZ.setSelection and setSelections accept public position objects
iZ.transaction accepts replaceSelection, changes, selection, and selections
iZ.wordAt, posToOffset, and offsetToPos bridge public positions to CM offsets
cP base provides getDoc, setLine, somethingSelected, setCursor, and processLines
```

Observed source editor event bridge:

```text
aZ.onUpdate triggers workspace editor-change with (editor, owner) when docChanged is true
aZ.onUpdate triggers workspace editor-selection-change with (editor, owner) when selectionSet, focusChanged, or non-set doc change is true
oZ listens for contextmenu on the markdown-source-view root, but editor-menu only fires when the event maps into cm.contentDOM
source editor-menu creates a menu and triggers workspace editor-menu with (menu, editor, owner)
workspace editor-paste and editor-drop public events take (event, editor, MarkdownView | MarkdownFileInfo), originate from the editor contentDOM event layer, and handlers use event.preventDefault() to claim handling
source and preview gutter context menus trigger markdown-viewport-menu with (menu, view, "source"|"preview", "gutter")
```

Current reconstruction parity:

```text
MarkdownView no longer pre-mounts inlineTitleEl, metadataContainerEl, or backlinksEl in the constructor
MarkdownView hides all modes and calls currentMode.show() during construction so the active mode performs first shared-node mounting
MarkdownEditMode.show() moves shared nodes into the CodeMirror-shaped source sizer
MarkdownReadingMode.show() moves inline title and metadata into renderer header and backlinks into renderer footer
source root is markdown-source-view cm-s-obsidian mod-cm6, while cm-editor belongs to EditorViewHost
EditorViewHost now reconstructs a CM-shaped host: cm-editor > cm-scroller > cm-sizer > cm-contentContainer > cm-gutters + cm-content
MarkdownView exposes sourceMode.cmEditor as the public compatibility field backed by the editor wrapper
MarkdownView.getViewData reads through currentMode.get(), matching W6's current-mode data model
editorLivePreviewField is reconstructed as a state field initialized from getSourceMode() === "live"
editorEditorField is reconstructed as a state field initialized to the EditorViewHost
editorInfoField is reconstructed as a state field initialized to the MarkdownView owner, matching the MarkdownFileInfo app/file/editor shape
editorViewField aliases editorInfoField to preserve the deprecated compatibility field
MarkdownView editor extensions are assembled as dynamic core field/plugin entries first, followed by workspace/plugin editor extensions
EditorViewHost now gives those reconstructed editor extensions executable lifecycle: nested extension arrays are flattened, state-field init values seed fields, view-plugin specs mount/update/destroy with the open editor, update listeners receive document/selection/dispatch updates, transaction filters can rewrite or block dispatched transactions, and DOM-class specs are applied/removed with the extension set. This follows the original `Plugin.registerEditorExtension -> Workspace.registerEditorExtension -> updateOptions -> source mode dynamic extensions` boundary while keeping the textarea-backed editor explicit.
setMode can switch source/live-preview even when the top-level mode remains source
setState restores mode without overwriting saved fold state
source textarea selection, keyup, and programmatic selection paths now trigger editor-selection-change with (editor, view)
public editor selection APIs now mirror back into the source textarea and trigger editor-selection-change with (editor, view), matching the observed CodeMirror selectionSet bridge
source textarea contextmenu now creates the editor menu and triggers editor-menu with (menu, editor, view)
source textarea contextmenu prevents the browser default menu when the reconstructed editor menu is shown
editor-menu now creates the observed section order before plugin hooks (`title`, `correction`, `spellcheck`, `open`, `selection-link`, `selection`, `clipboard`, `info`, `action`, `view`, `danger`) so plugin items can participate in section sorting after built-in items are present
editor-menu now accepts source link context from MarkdownView hit-testing; Edit link is added directly by the editor menu path, internal links delegate to `Workspace.handleLinkContextMenu(...)` before the final `editor-menu` hook and resolved files trigger `file-menu` with source `link-context-menu`, while external markdown links delegate to `Workspace.handleExternalLinkContextMenu(...)` and trigger `url-menu`
editor-menu now accepts source external-ref-link context from MarkdownView hit-testing; `[label][id]` right-clicks on the reference id resolve through `metadataCache.getFileCache(file).referenceLinks`, skip `Edit link`, then delegate to `Workspace.handleExternalLinkContextMenu(...)` and trigger `url-menu`
editor-menu now accepts source tag context from MarkdownView hit-testing; Edit tag is added directly in the `selection` section and selects the tag body without the leading `#`, matching the original `setSelection(start + 1, end)` behavior
editor-menu now accepts source footref context from MarkdownView hit-testing; MetadataCache now keeps `footnotes` and `footnoteRefs` as separate arrays from `referenceLinks`; Delete footref and note resolves the matching definition from `metadataCache.getFileCache(file).footnotes`, removes the reference plus the matching footnote definition in one editor transaction, and preserves the original `definition.position.start.offset - 1` deletion boundary that leaves the surrounding blank-line shape intact
editor-menu now includes executable selection-link defaults before the plugin hook: Insert link inserts `[[selection]]`, keeps the cursor before the closing brackets, and forces the existing LinkSuggest pipeline for empty links; Insert external link inserts `[selection]()` and keeps the cursor inside the URL slot for non-empty selections or inside `[]` for empty selections; both are disabled for trimmed multiline selections
editor-menu now includes executable clipboard defaults before the plugin hook: Cut, Copy, Paste, Paste as plain text, and Select all; Cut/Copy are disabled when the public editor has no selection
source editor contentDOM paste/drop now forwards the native event to workspace editor-paste/editor-drop with (event, editor, view), preserving defaultPrevented semantics for plugins
source paste now follows the observed default chain for URL paste in the single-selection textarea host: editor-paste fires first, defaultPrevented stops the chain, selected single-line text plus a URL clipboard value is replaced as `[selection](url)`, URLs are accepted through the observed no-space + `new URL(...)` rule, and false URL-paste cases fall back to normal text insertion
source gutter contextmenu and preview viewport gutter contextmenu now trigger markdown-viewport-menu with (menu, view, "source"|"preview", "gutter")
source gutter and preview viewport context menus prevent the browser default menu when the reconstructed markdown viewport menu is shown
SimpleEditor now implements the core public Editor API shape from obsidian.d.ts for pure text operations: line/range reads, selections, replaceRange, replaceSelection, transaction, position conversion, wordAt, scroll/focus stubs, and processLines
Editor is now a runtime abstract class exported through the plugin module facade, and SimpleEditor extends it so plugin code can reference `obsidian.Editor` at runtime
SimpleEditor now exposes document-change and selection-change listeners used by MarkdownView to mirror public editor API mutations back into TextFileView data, textarea state, editor-change/editor-selection-change events, and the save pipeline; the document bridge compares against TextFileView's stored data instead of current-mode data so source-mode editor mutations are not mistaken for already-synchronized view data
Plugin.registerCodeMirror is now exposed as the observed no-op compatibility shim instead of being mapped to CM6 editor extensions
MarkdownView checklist clicks now route through the owner edit path so TextFileView data, editor state, renderer text, and scheduled save remain synchronized
propertiesInDocument defaults to visible
canShowProperties hides metadata UI in raw source mode and for hidden/source config values
previewRendererEl show-properties follows propertiesInDocument !== hidden while metadata UI still follows canShowProperties
```

Remaining editor-menu gap:

```text
The current source hit-testing covers wiki links, markdown links, reference-style external links, source tags, and footrefs in the textarea-backed editor. Deeper CodeMirror token kinds from the original menu path, such as spellcheck corrections, phone-only Open link behavior, and Electron editFlags/native-menu behavior, remain separate layers.
```

Validation command used for this slice:

```text
bunx vitest run src/views/MarkdownViewPropertyKeys.test.ts src/markdown/MarkdownPreviewRenderer.test.ts src/plugin/PluginLifecycle.test.ts src/workspace/WorkspaceLayoutPersistence.test.ts src/workspace/WorkspaceSplit.test.ts && bunx tsc --noEmit && bunx oxlint -c oxlint.json src --quiet
```

## Markdown editor internal drag/drop

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- `TL(e,t,n,i)` at offset `1562729`: converts an internal draggable source into markdown link/embed text.
- `AL.handleDrop` at offset `1564668`: Markdown editor body drop handler.
- `$y(e)` at offset `1073571`: embeddable extension predicate.
- `MT(e)` at offset `1331939`: extracts link subpath from linktext.
- `IT(e)` at offset `1332667`: sanitizes heading text into a heading subpath.
- `WorkspaceLeaf.handleDrop` at offset `1412851`: open-in-leaf modifier path.

Observed behavior:

- `AL.handleDrop` first reads `app.dragManager.draggable`.
- With internal drag plus open-in-leaf modifier, it prevents default and delegates to `info.handleDrop(e, draggable, false)` before link conversion.
- The open-in-leaf modifier is `Shift` on macOS and `Alt` on non-macOS platforms.
- Otherwise it calls `TL(app, draggable, editorPath, true).join("\n")` and inserts the result into the editor selection.
- `TL(..., true)` prefixes `!` only when the file extension is embeddable: `bmp`, `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `avif`, `mp3`, `wav`, `m4a`, `3gp`, `flac`, `ogg`, `oga`, `opus`, `mp4`, `webm`, `ogv`, `mov`, `mkv`, `pdf`, `base`, `canvas`.
- `file` returns one generated markdown link.
- `files` maps only `TFile` instances and ignores folders, then joins links with newline at the drop handler level.
- `link` with a resolved file uses the linktext subpath and generates a markdown link to that file.
- `link` without a file inserts raw `linktext`.
- `heading` uses `#` plus sanitized heading text, where `:`, `#`, `|`, `^`, backslash, newlines, `%%`, `[[`, and `]]` are replaced with spaces and whitespace is collapsed.
- `bookmarks` only processes wrapped file bookmark items at `items[].item`, resolves `item.path` back to a vault file, and passes `item.subpath` plus `item.title` as alias to `generateMarkdownLink`.

Local reconstruction note:

- The original uses CodeMirror `posAtCoords({x, y})` before `replaceSelection`. The reconstructed editor currently uses a textarea-backed source editor, so the current implementation inserts at the textarea selection/cursor while preserving the reverse-engineered conversion semantics.

## Markdown editor source dragover

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- `jl = "macOS" === zl` at offset `547517`: platform flag used by open-in-leaf modifier checks.
- `MP` at offset `1535649`: maps `effectAllowed` to allowed drop effects.
- `SP(e,t)` at offset `1535827`: writes `event.dataTransfer.dropEffect = t` only when `MP[effectAllowed]` allows `t`.
- `xP.prototype.setAction` at offset `1541081`: shows/hides drag action text.
- `AL.prototype.handleDragOver` at offset `1563867`: Markdown editor body dragover logic.

Observed behavior:

- `AL.handleDragOver` reads `this.app.dragManager.draggable`.
- For an internal source, macOS `Shift` or non-macOS `Alt` returns immediately before setting `dropEffect` or action text.
- Internal `file`, `link`, and `heading` call `SP(event, "link")` and set action text to `insertLinkHere()`.
- Internal `files` calls `SP(event, "link")` and sets action text to `insertLinksHere()`.
- Internal `bookmarks` only participates when at least one `items[].item.type === "file"`; then it requests link drop effect and insert-link action text.
- `folder` and other source types are not matched by this handler.
- With no internal source, external dragover requests `link` when `event.ctrlKey` is true, otherwise `copy`.
- `AL.handleDragOver` itself does not call `event.preventDefault()`.
- `SP(event, effect)` only writes `dropEffect` if the browser drag source's `effectAllowed` permits the requested effect.
- The `effectAllowed` mapping is: `copy -> copy`, `copyLink -> copy/link`, `copyMove -> copy/move`, `link -> link`, `linkMove -> link/move`, `move -> move`, `all -> copy/link/move`, `none` and `uninitialized` -> no allowed effects.
- Local reconstruction currently has no Obsidian-style drag action text overlay for Markdown editor body, so it reproduces the concrete `dropEffect` side effect and leaves the action text UI absent rather than inventing a parallel mechanism.

## Markdown editor external drop and attachments

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- `CP` at offset `1538503`: extracts dropped file payloads from `DataTransfer.items`.
- `AL.handleDrop` at offset `1569325`: external editor drop entry.
- `AL.handleDropIntoEditor` at offset `1569998`: external file drop fallback.
- `AL.handleDataTransfer` at offset `1570622`: MIME/text drop conversion.
- `AL.insertFiles` at offset `1572468`: default external file import path.
- `AL.saveAttachment` at offset `1572957`: calls app-level attachment save.
- `AL.insertAttachmentEmbed` at offset `1573280`: inserts `!` plus generated markdown link.
- `app.saveAttachment` at offset `3721687`: resolves attachment path and calls `vault.createBinary`.

Observed behavior:

- Internal draggable drops do not trigger `editor-drop`; external drops do.
- External drop first exits if the event is already `defaultPrevented`, then triggers `editor-drop`, then exits if a listener prevented it.
- Unless `Shift` is held, external drop first calls `handleDataTransfer`.
- `handleDataTransfer` checks `text/html`, Obsidian HTML marker plus `text/plain`, `text/markdown`, HTML conversion, then `text/uri-list`.
- `text/markdown` is inserted as-is.
- `text/uri-list` with different `text/plain` becomes `[plain](uri)`; image-like URI targets receive a leading `!`.
- Standalone `text/plain` is not inserted by `handleDataTransfer`.
- If MIME conversion returns no string, `handleDropIntoEditor` handles dropped files.
- External file link mode is macOS `Alt`, non-macOS `Ctrl`.
- In file link mode, vault files use `fileManager.generateMarkdownLink`; external filesystem files use `[name](file://...)`, and image-like external files receive a leading `!`.
- In default file import mode, dropped files call `preventDefault`, are saved as attachments via `vault.getAvailablePathForAttachments` plus `vault.createBinary`, and inserted as embeds with `!` plus `generateMarkdownLink`.

Local reconstruction notes:

- `FileSystemAdapter` now implements real `readBinary` and `writeBinary`, so attachment import can persist bytes in desktop-backed vaults.
- The in-memory fallback vault still stores binary content as a placeholder string; MarkdownView tests therefore assert attachment creation and embed insertion, while FileSystemAdapter tests assert byte-preserving filesystem IO.
- Current status: HTML-to-Markdown conversion, Obsidian HTML marker guard, `.webloc/.url` filename-only URI handling, Electron `webUtils.getPathForFile` fallback, and drop-coordinate insertion are reconstructed in the local implementation.

## Markdown editor HTML-to-Markdown drop conversion

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- `function yP(e){ return hP.turndown(e) }` at offset `1533555`.
- External drop calls `yP(o.innerHTML.trim())` at offset `1567375`.
- `hP` is a `window.TurndownService` configured with `headingStyle: "atx"`, `hr: "---"`, `bulletListMarker: "-"`, `codeBlockStyle: "fenced"`, `fence: "```"`, and `linkStyle: "inlined"`.

Observed behavior:

- `text/markdown` wins over HTML conversion.
- HTML conversion is gated by vault config `autoConvertHtml`.
- Obsidian HTML marker plus `text/plain` returns null to avoid reconverting Obsidian-generated HTML.
- Obsidian HTML marker without `text/plain` does not trigger the marker guard; later `text/markdown` or configured HTML conversion can still handle the payload.
- HTML is sanitized before conversion in the original bundle; the local reconstruction still needs the separate sanitizer/data-URI attachment layer.
- `yP` itself is only a thin wrapper over TurndownService; most behavior comes from Turndown defaults plus Obsidian rules.
- Obsidian disables Turndown escaping by assigning `hP.escape = identity`.
- Custom rules include inline links, images, list items, task checkboxes, highlighted code blocks, strikethrough, mark/highlight, and GFM-style tables.
- Links are inline markdown links; URL spaces become `%20`, parentheses are escaped, and titles are quoted with escaped quotes.
- Images become `![alt](src "title")`, with the same URL/title normalization.
- List items use `- ` or ordered numbering, trim leading newlines, compress trailing newlines, and indent internal newlines by four spaces.
- `input[type=checkbox]` under `li` becomes `[x] ` or `[ ] `.
- Highlighted code containers like `highlight-text-LANG` or `highlight-source-LANG` produce fenced code blocks with language `LANG`.
- Tables use pipe syntax, alignments `left -> :--`, `right -> --:`, `center -> :-:`, escape cell pipes, and synthesize an empty header when no header row exists.

Local reconstruction notes:

- No Turndown dependency exists in `package.json`; `src/markdown/HtmlToMarkdown.ts` is a local pure conversion utility that reconstructs the core rules above.
- `MarkdownView` calls this utility only after `text/markdown` priority and only when `autoConvertHtml` is enabled.
- `MarkdownView` preserves the original marker guard exactly: `text/html` containing `<!-- obsidian -->` returns null only when `text/plain` is also present; marker HTML without plain text still follows the ordinary markdown/HTML priority.
- The sanitizer layer (`xL`/DOMPurify options), large `data:image` detachment/saving, and full Turndown edge behavior are separate reconstruction layers from the base HTML-to-Markdown converter.

## Markdown editor HTML drop sanitizer and media preprocessing

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- `window.DOMPurify = EL` at offset `1562263`.
- `EL.addHook("afterSanitizeAttributes", ...)` at offset `1562283`.
- Sanitizer config `SL` at offset `1562470`.
- `function xL(e)` at offset `1562656`.
- `document.importNode(EL.sanitize(e, SL), true)` at offsets `1562678` and `1562698`.
- `r.findAll("img, audio, video")` at offset `1566343`.
- resource path prefix conversion at offsets `1566471` to `1566653`.
- long `data:` URL detach at offsets `1566719` to `1566779`.
- data URL base64 parse and `saveAttachment("Pasted image", ...)` at offsets `1567066` to `1567171`.

Observed behavior:

- Raw HTML is sanitized into a `DocumentFragment`, then imported into the current document.
- Sanitizer config returns a DOM fragment, forbids `style`, allows unknown protocols, allows `iframe`, and allows iframe-related attributes plus `data-tooltip-position`.
- Sanitizer hook forces all anchors to `target="_blank"` and adds `rel="noopener nofollow"` when `rel` is missing.
- The sanitized fragment is appended to a temporary `div` before media preprocessing and `yP(container.innerHTML.trim())`.
- `img`, `audio`, and `video` nodes are scanned before conversion.
- Desktop resource-path URLs are converted back to `file:///...`, then resolved through `vault.resolveFileUrl`; vault files are rewritten to linktext through `metadataCache.fileToLinktext`.
- Media nodes with `src.startsWith("data:")` and `src.length > 1000` are collected and detached before Markdown conversion.
- Detached data URLs are parsed with `^data:([\w/\-.]+);base64,(.*)$`.
- Only `image/png` and `image/jpeg` are saved as attachments from this path.
- Detached image saves happen asynchronously as a side effect. The Markdown conversion result is returned immediately.
- Saved detached images use name `Pasted image YYYYMMDDHHmmss`, are inserted as embeds, and append two newlines.

Local reconstruction notes:

- `src/markdown/HtmlDropPreprocessor.ts` implements the local sanitizer/preprocessor boundary: ignored tag removal, unsafe attribute cleanup, anchor hook, media scan, long PNG/JPEG data URL detach and decode.
- `MarkdownView` preprocesses HTML before `htmlToMarkdown`, then asynchronously saves detached images using the existing vault attachment path plus `createBinary` pipeline.
- The local sanitizer is not a full DOMPurify clone. It intentionally preserves the same architectural boundary while avoiding a new dependency.
- Desktop `resourcePathPrefix`, `vault.resolveFileUrl`, and `metadataCache.fileToLinktext` rewriting now live in the follow-up media resource URL rewriting layer below.

## HTML drop media resource URL rewriting

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- `Yl.resourcePathPrefix` default `"file:///"` at offset `552254`.
- Desktop override `Yl.resourcePathPrefix = ipcRenderer.sendSync("file-url")` at offset `678249`.
- `Yl.isDesktopApp = true` desktop startup assignment at offset `3726488`.
- Vault `getResourcePath(file)` adapter forwarding at offset `1352428`.
- Desktop adapter `getResourcePath(path)` at offset `574202`.
- Vault `resolveFileUrl(url)` at offset `1356791`.
- Vault `resolveFilePath(nativePath)` at offset `1357075`.
- HTML media rewrite condition `Yl.isDesktopApp && c.src.startsWith(Yl.resourcePathPrefix)` at offset `1571128`.
- Rewrite to `file:///` at offset `1571186`.
- `this.app.vault.resolveFileUrl(c.src)` at offset `1571255`.
- `metadataCache.fileToLinktext(u, this.getPath(), true)` at offset `1571316`.
- `metadataCache.fileToLinktext` definition at offset `1586608`.

Observed behavior:

- `resourcePathPrefix` is host-injected on desktop through IPC; the static default is `file:///`.
- Resource URL rewrite only runs on desktop and only when media `src` starts with `resourcePathPrefix`.
- The media `src` is rewritten by replacing the prefix with `file:///` and then passed through `vault.resolveFileUrl`.
- `resolveFileUrl` strips the resource prefix and `?mtime` query when appropriate, converts `file://` to a native path, and delegates to `resolveFilePath`.
- `resolveFilePath` only returns a file when the native path is inside the vault adapter base path and the vault-relative path resolves to a `TFile`.
- If a vault file is found, media `src` becomes `metadataCache.fileToLinktext(file, currentPath, true)` before HTML-to-Markdown conversion.
- `fileToLinktext(..., true)` omits `.md` only for Markdown files. Non-Markdown media keeps its file name or path.
- In `shortest` link format, the short file name is used only when it uniquely resolves back to the same file; otherwise the vault-relative path is used.
- In `relative` format, the result is relative to the current file path. In `absolute` format, the vault path is used.

Local reconstruction notes:

- `FileSystemAdapter.resolvePath(urlOrPath)` now maps `file://` URLs and native absolute paths back to vault-relative paths only when they are inside the adapter base path.
- `Vault.resolveFilePath(urlOrPath)` delegates to the adapter and returns a vault-relative path only when that path resolves to a `TFile`; `Vault.resolveFileUrl(urlOrPath)` builds on it and returns the file object.
- `MetadataCache.fileToLinktext(file, sourcePath, omitMdExtension)` exposes the Obsidian linktext behavior needed by media rewriting without changing `FileManager.generateMarkdownLink` semantics; `FileManager.fileToLinktext(...)` remains as a compatibility delegate.
- `HtmlDropPreprocessor` accepts a resource prefix and media linktext resolver callback. It remains App/Vault agnostic.
- `MarkdownView` wires that callback to `vault.resolveFileUrl` plus `metadataCache.fileToLinktext(..., true)`.
- The local reconstruction does not invent the real Electron IPC `file-url` prefix; it supports the default/file URL path and adapter-resolved paths that can be tested locally.

## Markdown preview file link resource rewriting

Reverse evidence from original `App.fixFileLinks`:

- The original App registers a Markdown postprocessor on desktop that calls `fixFileLinks(element, sourcePath)`.
- `fixFileLinks` scans `img`, `audio`, `video`, `source`, and `iframe` nodes.
- Desktop `file:///` media URLs are rewritten through the host resource prefix before display.
- Internal media `src` values are decoded back to linktext, resolved through `metadataCache.getFirstLinkpathDest(src, sourcePath)`, and replaced with `vault.getResourcePath(file)` when the target is found.

Reconstruction notes:

- `src/app/App.ts` now exposes `fixFileLinks(el, sourcePath)` and rewrites internal media `src` attributes to vault resource paths.
- `src/markdown/MarkdownDefaultProcessors.ts` registers the App file-link fixer as a default Markdown postprocessor.
- The current local implementation skips external/data/blob protocol sources and supports adapter-backed `vault.resolveFileUrl(...)` plus linktext resolution for relative media paths.
- Tests cover the default postprocessor path by inserting an internal media node before `fixFileLinks` runs and verifying it becomes a vault resource URL.

## Markdown editor paste / clipboard pipeline

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- `CP(dataTransfer, ...)` at byte offset `1538503`.
- `DL = "<!-- obsidian -->"` at byte offset `1568058`.
- `AL.handlePaste` at byte offset `1568255`.
- `AL.handleDataTransfer` at byte offset `1570610`.
- `AL.insertFiles` at byte offset `1572456`.
- `tryPasteUrl` at byte offset `2420176`.
- CodeMirror built-in paste `Rr.paste` at byte offset `414713`.

Observed paste order:

- Source editor paste first calls `workspace.trigger("editor-paste", event, editor, info)`.
- If a listener prevents default, no default paste work continues.
- Otherwise CodeMirror paste reads `text/plain || text/uri-list` and runs Obsidian's clipboard paste hook.
- The hook order is `handleDataTransfer`, then URL-over-selection handling, then `CP(dataTransfer, "clipboard", true)` file/image handling, then default text insertion.
- `handleDataTransfer` uses the same MIME priority as external drop: Obsidian HTML marker guard, `text/markdown`, gated `text/html`, single image plus file guard, then `text/uri-list`.
- Plain text is not directly handled by `handleDataTransfer`; it falls through to URL handling or default text insertion.
- `CP(..., "clipboard", true)` scans `DataTransfer.items` for file items, reads file/blob data, names pathless PNG/JPEG files `Pasted image`, and inserts attachments through the same embed path.
- Electron native clipboard image/file fallback exists in the original bundle but depends on desktop APIs.

Local reconstruction notes:

- `MarkdownView.handleSourcePaste` now mirrors the hook order after `editor-paste`: external DataTransfer markdown/html/URI conversion, URL-over-selection, clipboard file/image attachment insertion, then plain text fallback.
- The existing URL paste behavior remains protected: selected single-line text plus a URL becomes `[selection](url)`, empty selection inserts the raw URL, and multi-line selection falls back to raw text replacement.
- Clipboard file/image paste reuses the same attachment import path as external file drop.
- Electron native clipboard fallback is not reconstructed because it requires desktop clipboard APIs.

## Markdown source paste of `obsidian/properties`

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- `AL.prototype.handlePaste` at offset `1563610`.
- `workspace.trigger("editor-paste", ...)` at offset `1563712`.
- `clipboardData.getData("obsidian/properties")` in `AL.handlePaste` at offset `1563789`.
- `this.info.handlePaste(event)` at offset `1563847`.
- Metadata editor `handlePaste` at offset `1675591`.
- Markdown view `W6.handlePaste` at offset `2891524`.

Observed behavior:

- `AL.handlePaste` first checks whether the event is already default-prevented.
- If not, it triggers `editor-paste` before checking `obsidian/properties`.
- If `editor-paste` prevents default, the properties branch is skipped.
- The properties branch requires truthy `clipboardData.getData("obsidian/properties")` and a Markdown view-like `info instanceof W6`.
- `W6.handlePaste` checks the properties format again and delegates to its metadata editor.
- The metadata editor performs `preventDefault`, parses the JSON object, and inserts/merges properties.
- `AL.handlePaste` itself does not call `preventDefault` for this branch; consumption is performed by the metadata editor.

Local reconstruction notes:

- `MarkdownView.handleMetadataPaste` now returns a boolean indicating whether the paste was consumed.
- Source editor paste calls `handleMetadataPaste` immediately after `editor-paste` and before markdown/html/URI/URL/file/plain fallback handling.
- When consumed, source paste returns immediately so the clipboard `Text` format is not inserted into the document body.
- The branch is guarded by `this.file` so invalid source states do not swallow normal paste.

## Markdown editor `text/uri-list` and `.webloc/.url` handling

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- `CP(dataTransfer, type, readData)` definition at offset `1538503`.
- `AL.handleDataTransfer` at offset `1570610`.
- `text/uri-list` branch at offset `1572055`.
- No-plain-text `CP(dataTransfer, "drop", false)` call at offset `1572128`.
- `.webloc/.url` extension check at offset `1572210`.
- Return first file item name at offset `1572237`.
- Return raw URI at offset `1572254`.
- `[plain](uri)` logic at offset `1572407`.

Observed behavior:

- Paste and drop share `AL.handleDataTransfer`.
- If `text/uri-list` exists and `text/plain` is absent, Obsidian calls `CP(dataTransfer, "drop", false)`.
- `CP(..., false)` scans `DataTransfer.items` for file items and captures name/extension/path metadata only. It does not read file contents.
- Only the first file item is checked for extension `webloc` or `url`.
- If that first file item matches, the returned markdown text is the filename without extension.
- If not, the raw URI is returned.
- If `text/plain` is present and differs from the URI case-insensitively and from `decodeURIComponent(uri.toLowerCase())`, Obsidian returns `[plain](uri)` or `![plain](uri)` for image URI extensions.
- If plain text matches the URI or decoded URI, `handleDataTransfer` returns null and fallback paste logic can insert the plain text.

Local reconstruction notes:

- `MarkdownView` now centralizes the URI branch in `getUriListMarkdown`.
- The local implementation intentionally does not parse `.webloc/.url` file contents; this matches the observed `CP(..., false)` behavior.
- Drop and paste both use the same branch through `getExternalDataTransferMarkdown`.

## Markdown editor URL paste over selections

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- CodeMirror paste handler `Rr.paste` around offset `410356`.
- `runHandlers` event prevention path around offset `398520`.
- `AL.handleDataTransfer` around offset `1570610`.
- `tryPasteUrl` around offset `2415459`.
- URL validation helper `Qc` around offset `560309`.

Observed behavior:

- CodeMirror paste first reads `clipboardData.getData("text/plain") || clipboardData.getData("text/uri-list")`.
- Obsidian's clipboard hook then runs `handleDataTransfer(clipboardData)`.
- URL paste receives `handleDataTransfer(...) || text/plain || text/uri-list`, so converted markdown/URI payloads are tried by URL-over-selection before being inserted normally.
- `tryPasteUrl` requires at least one non-empty selection range.
- Every non-empty range must stay on one document line; any multi-line range makes URL wrapping return false.
- A single valid URL payload is reused for every selection range.
- A multi-line payload is split with `payload.split("\n")`; the line count must exactly match `selection.ranges.length`, and every line must pass the URL validator.
- Empty ranges can participate only when at least one range is non-empty; empty ranges receive the bare URL while non-empty ranges receive `[selection](url)`.
- The URL validator rejects ordinary spaces with `!value.contains(" ")`, then accepts anything `new URL(value)` accepts.
- It does not require `http` or `https`; `mailto:`, `obsidian://`, and `file:///` style URLs are valid.
- It does not trim the payload before validation or insertion.
- `tryPasteUrl` dispatches editor changes and returns true, but the DOM event is prevented by the outer CodeMirror event handler after it sees a handled paste.

Local reconstruction notes:

- `MarkdownView.handleSourcePaste` now mirrors the original payload chain: external DataTransfer markdown/html/URI conversion is attempted first, but the resulting string is passed through URL-over-selection before normal insertion.
- `tryPasteUrl` now uses the editor selection ranges instead of only reading the textarea selection directly.
- The source textarea selection is synced into the editor for the normal single-selection UI path.
- Existing multiple editor selection ranges are preserved for headless/editor-model tests, but the textarea UI still cannot visually represent true CodeMirror multi-cursor selections.
- URL payloads are no longer trimmed before validation, matching the observed bundle behavior.

## Command manager and command palette execution

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- Command execution helper `K6` around offset `2896811`.
- Command manager `Y6` around offset `2896952`.
- `Y6.addCommand` around offset `2897044`.
- `Y6.removeCommand` around offset `2897787`.
- `Y6.listCommands` around offset `2898021`.
- `Y6.executeCommandById` around offset `2898262`.
- `Y6.executeCommand` around offset `2898370`.
- Plugin `Plugin.addCommand` wrapper around offset `2739160`.
- Built-in plugin `registerGlobalCommand` around offset `2763159`.
- Command palette open command around offset `3192716`.
- Command palette `getCommands` around offset `3193801`.
- Command palette modal around offset `3194204`.

Observed behavior:

- The command manager stores commands and editor commands by command id.
- `mobileOnly` commands are skipped outside mobile runtime.
- Commands with `editorCallback` or `editorCheckCallback` are wrapped into `checkCallback`.
- The editor wrapper reads `workspace.activeEditor`, rejects missing editor context, rejects preview mode unless `allowPreview`, rejects inline-title/title focus, and rejects metadata-container focus unless `allowProperties`.
- `listCommands()` returns commands without `checkCallback`, or commands whose `checkCallback(true)` is truthy.
- `listCommands()` catches availability-check exceptions and filters those commands out.
- `executeCommandById(id, event)` resolves the command then delegates to `executeCommand(command, event)`.
- `executeCommand` sets `app.lastEvent`, calls the helper, catches thrown errors, and returns `false` only on exception.
- The helper executes `checkCallback(false)` when present, otherwise `callback()`, otherwise logs a missing callback error.
- The command manager does not use the return value of `checkCallback(false)` to decide whether execution succeeded.
- The command palette lists commands through `app.commands.listCommands()`.
- Command palette filtering uses fuzzy matching over `command.name`.
- Pinned commands are separated and ordered by the pinned setting; non-pinned commands are name-sorted then reordered by recent command ids.
- Command palette execution sets `app.lastEvent`, calls the raw command helper directly, then records the command id in recent commands.
- Because command palette calls the helper directly, a thrown command aborts before recent command recording; it does not go through the command manager catch path.

Local reconstruction notes:

- `CommandManager.executeCommand` now delegates the shared callback/checkCallback body to `runCommandCallback`.
- `CommandPalette.onChooseItem` now mirrors the original by setting `app.lastEvent`, calling `runCommandCallback` directly, and recording recent commands only after the helper returns.
- Hotkey execution still uses `CommandManager.executeCommand`, preserving the caught-error path, but it does not pass the triggering `KeyboardEvent` and does not prefilter through `listCommands()` before consuming a matching shortcut.

## Markdown post processors and code block processors

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- `MarkdownRenderChild` export `zz` around offset `1838941`.
- `MarkdownPreviewSection` `qz` around offset `1839000`.
- `MarkdownPreviewRenderer.registerPostProcessor` around offset `1858554`.
- `MarkdownPreviewRenderer.registerCodeBlockPostProcessor` around offset `1858909`.
- `MarkdownPreviewRenderer.createCodeBlockPostProcessor` around offset `1859146`.
- `MarkdownView`/preview section postprocess around offset `1877947`.
- Static markdown postprocess loop around offset `1878695`.
- Plugin `registerMarkdownPostProcessor` around offset `2740232`.
- Plugin `registerMarkdownCodeBlockProcessor` around offset `2740499`.

Observed behavior:

- `MarkdownRenderChild` is a `Component` subclass that stores `containerEl`.
- `MarkdownPreviewSection` has a `usesFrontMatter` boolean initialized to false.
- `registerPostProcessor(processor, sortOrder)` assigns `processor.sortOrder = sortOrder`, appends the function, and sorts by `(sortOrder || 0)` ascending.
- `unregisterPostProcessor(processor)` removes the same function reference from the post processor array.
- `registerCodeBlockPostProcessor(language, processor)` stores the processor in `codeBlockPostProcessors` and throws if that language already exists.
- `createCodeBlockPostProcessor(language, processor)` returns a normal markdown postprocessor.
- The code-block wrapper scans rendered DOM for `code.language-${language}`, replaces the parent `pre` with `div.block-language-${language}`, installs `context.replaceCode`, then calls the original processor.
- If the code block processor returns a promise, the wrapper pushes it to `context.promises`.
- Plugin `registerMarkdownCodeBlockProcessor` registers both the wrapper postprocessor and the language processor table entry, then unregisters both on plugin unload.
- Plugin `registerMarkdownPostProcessor` triggers `workspace.trigger("post-processor-change")` on register and unregister.
- Preview postprocessing creates a context with `docId`, `sourcePath`, `frontmatter`, `promises`, `addChild`, `getSectionInfo`, `replace`, `containerEl`, and `el`.
- After static postprocess returns, the preview section stores `section.usesFrontMatter = !!context.usesFrontMatter`.
- The static postprocess loop calls each registered postprocessor and pushes returned promises into `context.promises`.
- Internal embeds are processed after registered postprocessors.

Local reconstruction notes:

- The local code block processor path intentionally keeps the original wrapper-postprocessor design; the registry exists for duplicate-language tracking and API parity, not as the direct block-rendering path.
- `MarkdownRenderer` now exposes an internal `onSectionPostProcess` option so preview rendering can observe postprocessor context after a section is processed.
- `MarkdownPreviewRenderer` now records `context.usesFrontMatter === true` on the collected `MarkdownPreviewSection`, matching the observed section-level contract.

## Events and Component lifecycle

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- Public export `Events => VT` around offset `252329`.
- Public export `Component => jm` around offset `252312`.
- `Component` implementation `jm` around offset `700727`.
- `Events` implementation `VT` around offset `1335338`.

Observed `Events` behavior:

- `Events` stores listener buckets in an object keyed by event name.
- `on(name, fn, ctx)` returns a plain event reference object: `{ e: this, name, fn, ctx }`.
- The returned event reference is not callable.
- `off(name, fn)` removes listeners whose original `fn` differs from the passed function; if no listeners remain, the event bucket is deleted.
- Calling `off(name)` without a function deletes the bucket.
- `offref(ref)` removes that exact ref object from the bucket named by `ref.name`.
- `trigger(name, ...args)` snapshots the current listener array before iterating.
- `tryTrigger(ref, args)` invokes `ref.fn.apply(ref.ctx, args)`.
- Listener exceptions are caught and rethrown asynchronously with `setTimeout(() => { throw error }, 0)`, so later listeners in the snapshot still run.

Observed `Component` behavior:

- A component starts with `_loaded = false`, `_events = []`, and `_children = []`.
- `load()` sets `_loaded = true`, calls `onload()`, then loads a snapshot of children in insertion order.
- If `onload()` or child `load()` returns promises, `load()` returns `Promise.all(...).then()`.
- Base `Component.load()` does not wait for an async parent `onload()` before starting child loads; it collects both promises.
- `unload()` sets `_loaded = false`, unloads children in LIFO order, runs registered cleanup callbacks in LIFO order, then calls `onunload()`.
- `unload()` does not await an async `onunload()`.
- `addChild(child)` pushes the child and immediately loads it if the parent is already loaded.
- `removeChild(child)` removes it and unloads it immediately.
- `registerEvent(ref)` registers cleanup as `ref.e.offref(ref)`.
- `registerDomEvent`, `registerScopeEvent`, and `registerInterval` register the corresponding remove/unregister/clear cleanup callbacks.

Local reconstruction notes:

- `Events.EventRef` is public-typed as an opaque reference while the internal runtime object still matches the observed `{ e, name, fn, ctx }` shape used by cleanup paths.
- `Events.trigger` keeps snapshot iteration and async rethrow behavior.
- `Events.off(name)` now deletes the whole event bucket, matching the original no-function branch.
- `Component.registerEvent` now unregisters through the original owner-ref cleanup path (`eventRef.e.offref(eventRef)`) via an internal helper, without exposing those fields in the public `EventRef` type.

## Metadata link suggestions and supported files

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Reverse symbols and approximate bundle offsets:

- Default `showUnsupportedFiles: false` config around offset `1205587`.
- `MetadataCache.isSupportedFile` around offset `1593373`.
- `MetadataCache.getLinkSuggestions` around offset `1577588`.
- File explorer supported-file UI also uses `viewRegistry.isExtensionRegistered(file.extension)` around offset `3215000`.

Observed behavior:

- `getLinkSuggestions()` iterates `vault.getFiles()`.
- A file is included only when `isSupportedFile(file)` is true.
- `isSupportedFile(file)` returns `vault.getConfig("showUnsupportedFiles") || app.viewRegistry.isExtensionRegistered(file.extension)`.
- This means “unsupported” means “extension not registered with the view registry”, not “non-Markdown”.
- Registered media/document extensions such as PDF can appear in link suggestions while `showUnsupportedFiles` is false.
- Markdown file suggestion paths omit `.md`; non-Markdown suggestion paths keep the full filename.
- Frontmatter aliases are read from the file cache and added as `{ file, path, alias }` suggestions.
- Frontmatter aliases are intentionally not used by `MetadataCache.getFirstLinkpathDest` / `getLinkpathDest`: the original runtime's linkpath lookup scans filename/path candidates from `uniqueFileLookup`, while alias extraction is used by suggestion/display flows. Bare `[[Alias Name]]` therefore remains unresolved unless a file/path itself matches that linkpath.
- Unresolved links are added after file suggestions, truncated to 500 characters, and skipped when their path was already seen.

Local reconstruction notes:

- The existing production `MetadataCache.getLinkSuggestions` already follows this rule.
- The link suggestion test now uses a registered PDF to prove registered non-Markdown files are supported, and an unregistered `.bin` file to prove `showUnsupportedFiles` controls truly unsupported extensions.

## EditorSuggest extension point

Source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Evidence anchors:
- `Plugin.registerEditorSuggest` calls `app.workspace.editorSuggest.addSuggest(suggest)` and registers unload cleanup with `removeSuggest(suggest)`.
- Obsidian's editor suggest manager keeps `suggests` as an array, so trigger order follows registration order. The first suggest whose `trigger` returns true stops the scan.
- `EditorSuggest.trigger(editor, file, flag)` only accepts a collapsed cursor selection. `onTrigger(cursor, editor, file)` returns the public trigger shape `{start,end,query}`, and the framework expands it into `context={editor,file,start,end,query}` before asking for suggestions.
- `getSuggestions(context)` may return `null` to represent a cancelled/no-op async result. `showSuggestions([])` closes, while `null` does not render suggestions.
- Async results from non-DOM file triggers are shown only if the editor still has focus; DOM-anchored editor triggers stay open because the textarea/CodeMirror bridge can report focus unreliably in reconstructed tests.
- Each `EditorSuggest` has `limit=100`; results are sliced before rendering.
- Public suggest ownership now matches the documented split: `ISuggestOwner<T>` exposes `renderSuggestion(value, el)` and `selectSuggestion(value, event)`, while the internal chooser owner also receives selection-change notifications.
- Public prompt instructions now use the official `Instruction` type name; the older local `PromptInstruction` name remains a compatibility alias.

Local reconstruction notes:
- `EditorSuggestContext` now carries optional `file`.
- `EditorSuggestManager` now mirrors registration-order triggering, null-result cancellation, empty-result close, single-cursor guard, Obsidian-style file-trigger focus guard for non-DOM file triggers, and per-suggest limit.
- `EditorSuggest.setInstructions()` now appends `.prompt-instructions` to the editor suggest container, matching the original `NI` instance shape.
- The DOM shape of the suggestion popup remains intentionally minimal because the Obsidian app DOM contract is being handled separately by Side.

## PopoverSuggest and AbstractInputSuggest

Source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Evidence anchors:
- `PopoverSuggest` (`EI`) owns an independent `Scope`, `suggestEl`, inner `.suggestion` container, and a shared chooser. `open()` pushes the scope and attaches DOM; `close()` clears suggestions, detaches DOM, cancels auto-destroy, and pops the scope.
- `PopoverSuggest` exposes `onEscapeKey`, `attachDom`, `detachDom`, `reposition(rect, dir='auto')`, and `setAutoDestroy(el)`.
- `AbstractInputSuggest` (`SI`) extends `PopoverSuggest`, takes `(app, textInputEl)`, defaults `limit=100`, and listens to `input`/`focus`/`blur`.
- `AbstractInputSuggest.onInputChange()` only queries while the input is active. `getSuggestions(value)` may return an array or a Promise; promise results are shown directly without request-token cancellation.
- `showSuggestions([])` closes. Non-empty suggestions are sliced by `limit`, rendered, opened, positioned next to the input, and tied to auto-destroy.
- `getValue()`/`setValue()` use `.value` for text inputs and `.innerText` for other elements.
- `selectSuggestion(value, event)` only calls the callback registered by `onSelect(callback)`; subclasses decide whether to close.
- The shared chooser supports selected value/element access, hover selection toggling, cyclic up/down selection, page/home/end movement, enter selection, click/auxclick selection, and selected-change callbacks.

Local reconstruction notes:
- Added `src/suggest/AbstractInputSuggest.ts` with `PopoverSuggest` and `AbstractInputSuggest` as public extension points.
- Reused `SuggestChooser` across modal and popover suggest layers by extracting a small `SuggestOwner` interface.
- Exported `PopoverSuggest` and `AbstractInputSuggest` from the public index and plugin API facade.

## Menu, MenuItem, and MenuSeparator

Source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Evidence anchors:
- `Menu` (`Ug`) initializes `items=[]`, `sections=[]`, `submenuConfigs={}`, `selected=-1`, `useNativeMenu=Menu.useNativeMenu`, and `showMacWritingTools=false`.
- `Menu` owns a `.menu` root, a `.menu-scroll` content container, and a background element in the original app. Local reconstruction keeps the root and scroll container while leaving mobile/background visuals to the DOM/UI layer.
- `addItem(callback)` and `addSeparator()` are no-ops after the menu has loaded/shown; otherwise they append to `items` and return `this`.
- The section API is `addSections(sectionNames)` plus `setSectionSubmenu(section, { title, icon?, disabled? })`. Unknown non-empty sections are appended to the section order.
- `sort()` buckets items by `item.section`, inserts separators between top-level section groups, trims trailing separators, wraps adjacent items in groups, and appends the empty/default section last unless explicitly included.
- Section submenu configs match `section === key` or `section` prefixed by `key.`. Matching items are moved into an auto-created submenu item, with the prefix stripped inside the submenu.
- `showAtMouseEvent(event)` delegates to `showAtPosition({x:event.clientX,y:event.clientY}, event.doc)`. `showAtPosition()` unloads previous DOM without firing `hideCallback`, returns `this`, and returns early for empty menus.
- `hide()` clears selection, closes submenus, cleans parent/submenu links, removes `has-active-menu` from the parent element, detaches DOM, invokes and clears `hideCallback`, and returns `this`. `close()` is just `hide()`.
- `onHide(callback)` stores a single hide callback in the original code.
- `MenuItem` (`Hg`) starts with `submenu=null`, `disabled=false`, `checked=null`, and `section=""`.
- `setTitle()` accepts string or DOM node. `setIcon()` fills or clears the icon slot. `removeIcon()` detaches the icon slot.
- `setChecked()` creates a distinct checked icon, stores `checked`, and toggles `mod-checked`; `setActive()` aliases `setChecked()`.
- `setDisabled()`, `setWarning()`, `setIsLabel()`, `setSection()`, `onClick()`, and `setSubmenu()` are chainable. `setSubmenu()` lazily creates a `new Menu()` and marks the item as a submenu item.
- `handleEvent()` prevents disabled items, opens submenu items, and for regular items runs the callback then hides the menu.

Local reconstruction notes:
- Rebuilt `src/ui/Menu.ts` around explicit section ordering, section-submenu grouping, one-shot post-show mutation guards, parent active state, submenu relationships, keyboard navigation, and hide callback semantics.
- `Menu.selected` now uses the original `-1` unselected sentinel, and instances initialize `useNativeMenu` from static `Menu.useNativeMenu`.
- Added focused tests for section sorting, section submenu extraction, checked state, post-show no-op mutation, `onHide`, parent cleanup, disabled navigation, and keyboard activation.

## Modal base class

Source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

Evidence anchors:
- `Modal` (`tb`) is constructed as `new Modal(app)` and stores `app`, `scope`, `containerEl`, `bgEl`, `modalEl`, `headerEl`, `titleEl`, and `contentEl`.
- Initial fields include `shouldRestoreSelection=true`, `selection=null`, `win=null`, `shouldAnimate=true`, `dimBackground=true`, and `bgOpacity="0.85"`.
- The constructor registers `Escape -> onEscapeKey`, sets the tab-focus container to `containerEl`, wires the close button to `close()`, and wires background clicks to `onClickOutside()`.
- There is no explicit public `isOpen` flag in the original base class; `open()` is guarded by `containerEl.parentNode`.
- `open()` captures active window selection/focus when `shouldRestoreSelection` is enabled, clears focus/selection, pushes the modal scope, appends the container to `activeWindow.document.body`, calls `onOpen()`, applies `mod-dim` and background opacity, pushes the modal into a global stack, focuses the modal when appropriate, and registers `beforeunload` for non-main windows.
- `close()` pops the scope, detaches the container, calls `onClose()`, then calls the close callback, removes the modal from the global stack, restores saved selection/focus, removes non-main-window unload listeners, and clears `win`.
- `onOpen()`, `onClose()`, `onWindowClose()`, `onClickOutside()`, and `onEscapeKey()` are overridable methods. Outside click and Escape close only when the event was not prevented.
- `setTitle(text)` sets title text and returns `this`.
- `setContent(value)` replaces text for strings but appends DOM nodes without clearing existing content.
- `setBackgroundOpacity(value)`, `setCloseCallback(callback)`, and `setDimBackground(value)` only update stored state and return `this`; visible styling follows from open/update behavior in the reconstruction.
- The original app keeps an internal modal stack and mobile back handling closes the stack top. No public `closeAll()` was found near the base class, but a compatibility helper can be built from the same stack semantics.

Local reconstruction notes:
- Adjusted `Modal.open()` idempotency to follow `containerEl.parentNode` rather than a separate open flag.
- Adjusted `setContent(Node)` to append nodes while preserving string replacement semantics.
- Added a lightweight modal stack with `Modal.getOpenModals()` and `Modal.closeAll()` to support global stack semantics.

### Setting and form components

Reverse evidence from the original `app.js` export map and minified constructors:

- Public symbols map to `Setting=zk`, `SettingGroup=qk`, `BaseComponent=jk`, `ValueComponent=Uk`, `ButtonComponent=Wk`, `ExtraButtonComponent=_k`, `AbstractTextComponent=Kk`, `TextComponent=Yk`, `SearchComponent=Qk`, `TextAreaComponent=Xk`, `MomentFormatComponent=Zk`, `DropdownComponent=Jk`, `ToggleComponent=Gk`, `ColorComponent=nC`, `ProgressBarComponent=eC`, and `SliderComponent=tC`.
- `BaseComponent` only owns `disabled`, `then(cb)`, and `setDisabled(bool)`; element-level disabled behavior is implemented by concrete components.
- `ValueComponent.registerOptionListener(record, key)` installs a getter/setter function that writes only when the argument is not `undefined`, then returns the current value.
- `Setting` creates `.setting-item`, `.setting-item-info`, `.setting-item-name`, `.setting-item-description`, and `.setting-item-control`; all `add*` methods push components into `components`, execute the callback, and return the host setting.
- `Setting.setDisabled(bool)` toggles `.is-disabled` on the setting and cascades `setDisabled` to every tracked component; `clear()` empties controls and resets `components`.
- `SettingGroup` lazily attaches its heading row only when heading text is non-empty; `addSearch` lazily creates `.setting-group-search` before `.setting-items`.
- `ButtonComponent` creates a plain `<button>`; click ignores disabled/no-callback cases, adds `mod-loading`, awaits the callback, then removes `mod-loading` in `finally`.
- `ToggleComponent` stores state in an internal `on` field; `setValue` calls `onChange` only when the value actually changes, and disabled clicks are ignored.
- `DropdownComponent.setValue` and text component `setValue` do not call `onChange`; native `change`/`input` events do.
- `ColorComponent.setValue`, `SliderComponent.setValue`, and toggle `setValue` call their callbacks when the value changes, matching the original component-specific behavior.
- `ColorComponent` now uses the public `RGB` and `HSL` type names for color conversion methods while preserving the earlier lowercase aliases as compatibility exports.
- `Setting.addText()` only installs Enter-to-blur behavior when the runtime has no physical keyboard (`Platform.hasPhysicalKeyboard === false`), matching the observed mobile-only branch.
- `SearchComponent` clear button does nothing while the component is disabled; enabled clears still call `onChanged()` and refocus the input.
- `SliderComponent` stops click propagation from the range input, matching the observed slider constructor.
- `ExtraButtonComponent` uses `.clickable-icon.extra-setting-button` with the default `lucide-settings` icon and does not add an extra explicit `tabIndex`/keydown activation path in the observed constructor.
- An internal number input component exists in the bundle, but no public `NumberComponent` export was found; the reconstruction keeps it out of the public plugin facade until stronger evidence appears.

### Plugin and SettingTab API parity

Reverse evidence from the original `app.js` plugin layer:

- Public symbols map to `Component=jm`, `Plugin=G0`, `SettingTab=_1`, and `PluginSettingTab=K0`.
- `SettingTab(app, setting)` is a runtime base class, not just a TypeScript shape. It stores `app`, `setting`, creates `containerEl=createDiv("vertical-tab-content")`, initializes `navEl=null`, and has a no-op `hide()`.
- `PluginSettingTab(app, plugin)` extends `SettingTab` via `super(app, app.setting)`, then sets `plugin`, `name=plugin.manifest.name`, and `id=plugin.manifest.id`.
- `PluginSettingTab.plugin` is modeled as a writable runtime field rather than a readonly constructor parameter property.
- `Plugin.load()` differs from base `Component.load()`: it awaits plugin `onload()`, then starts child component loads from a snapshot without awaiting those child load promises.
- `Plugin.loadData()` reads `vault.readPluginData(manifest.dir)` and only refreshes `_lastDataModifiedTime` for truthy data when `onExternalSettingsChange` exists.
- Core plugin setting tabs are internal in the original bundle; our wrapper keeps the existing section hints for renderer compatibility while inheriting the same runtime `SettingTab` base shape.
- The CommonJS `require("obsidian")` facade now exposes the same reconstructed runtime constructors that plugin authors commonly import from the main public module, including `DataAdapter`, `FileSystemAdapter`, `FileManager`, `MetadataCache`, `FuzzySuggestModal`, `Scope`, and `Keymap`.

### Plugin CLI handler API surface

Reverse evidence:

- The public plugin API export list includes `registerCliHandler(...)`.
- The internal plugin wrapper API surface also includes `registerCliHandler(...)`.
- `obsidian.d.ts` declares `CliData` as a string-keyed object, `CliFlag` with `value`, `description`, and `required`, `CliFlags = Record<string, CliFlag>`, and `CliHandler = (params: CliData) => string | Promise<string>`.
- The `Plugin.registerCliHandler(command, description, flags, handler)` docs require globally unique command IDs and recommend `<plugin-id>` / `<plugin-id>:<action>` naming.

Reconstruction notes:

- `src/app/App.ts` now owns a metadata-bearing CLI handler registry with command uniqueness checks, descriptions, flags, owner tracking, required-flag validation, and a small `runCliHandler` harness for tests/local desktop integration.
- `src/plugin/Plugin.ts` exposes the Obsidian-style `registerCliHandler(command, description, flags, handler)` for community plugins and automatically unregisters handlers during plugin unload.
- `src/plugin/Plugin.ts` widens `registerFileMenu` to the reconstructed `file-menu` event shape `(menu, file: TAbstractFile, source, leaf?)`, so plugin helpers can receive folders and the source leaf.
- `src/plugin/Plugin.ts` widens `registerEditorMenu` to the reconstructed editor-menu event shape `(menu, editor, MarkdownView | MarkdownFileInfo)`, matching the public workspace event payload.
- `src/plugin/InternalPluginWrapper.ts` exposes the same signature for core plugins and unregisters handlers during disable.
- `runCliHandler` accepts already-structured `CliData` and also parses simple `--flag` / `--flag=value` argument arrays for the reconstructed desktop harness; this keeps command-line parsing at the app boundary instead of plugin callbacks.


### Community plugin manager and manifest discovery

Reverse evidence from the original `$0` community plugin manager:

- `$0` stores `manifests`, `plugins`, `enabledPlugins`, `updates`, `autoCheckForUpdates`, `lastUpdateCheck`, and subscribes to vault `raw` events in the constructor.
- `loadManifests()` reads the plugin folder `${vault.configDir}/plugins`, loops child folders, reads each `manifest.json`, skips entries without `id`, sets `manifest.dir`, and normalizes missing or `obsidian` author values to an empty string.
- `loadManifest(dir)` performs the same manifest read for one plugin directory and updates the manifest table.
- `onRaw(path)` only routes enabled plugin `data.json` changes to the loaded plugin instance via `plugin.onConfigFileChange()`; it does not hot-reload `manifest.json` or `main.js`.
- `enablePlugin(id, userInitiated)` refuses deprecated plugins and refuses `isDesktopOnly` plugins on non-desktop/mobile runtimes before loading.
- The reconstruction keeps `PluginLoader.discoverPackages()` as the multi-folder equivalent of `loadManifests()` and adds `discoverPackage(dir)` as the single-folder equivalent of `loadManifest(dir)`.

### Community plugin manager facade

Reverse evidence from original `$0` usage and constructor shape:

- `$0` exposes mutable tables `manifests`, `plugins`, `enabledPlugins`, `updates`, plus `loadingPluginId` while a plugin is being enabled.
- `$0.getPluginFolder()` returns `${app.vault.configDir}/plugins`; in the reconstruction this is kept as the public facade value while the loader still reads paths relative to the config-store root.
- `$0.loadManifests()` and `$0.loadManifest(dir)` only populate manifest/package state; plugin enabling is separate.
- `$0.loadPlugin(id, userInitiated)` is a pure runtime load: it respects the global community-plugin switch and returns `undefined` when disabled, `null` when no manifest/package exists, or the plugin instance when loaded.
- `$0.enablePlugin(id, userInitiated)` performs validation and runtime loading but does not save `community-plugins.json`; `$0.enablePluginAndSave(id)` adds the id to `enabledPlugins` and persists the array.
- `$0.disablePlugin(id, userInitiated)` unloads without mutating saved enabled config; `$0.disablePluginAndSave(id)` removes the id from `enabledPlugins`, saves, then unloads.
- Existing reconstruction APIs `enable(id)` and `disable(id)` remain high-level aliases for the save variants so current UI and installer flows preserve their behavior while the Obsidian-style facade is available.

### Community plugin startup config and setEnable

Reverse evidence from original `$0.initialize()` and `$0.setEnable()`:

- `initialize()` reads `community-plugins.json`; only an array is accepted, and any non-array value is treated as an empty list.
- Startup copies that array into `enabledPlugins`, discovers manifests, then attempts to enable configured ids in order using the pure `enablePlugin(id)` path.
- Missing or failed plugin ids are not removed from `enabledPlugins` during startup; the manager saves the current set afterward, preserving configured ids unless a user action deletes them.
- `enablePlugin(id)` and `disablePlugin(id)` are runtime operations and do not mutate the saved enabled-plugin list.
- `enablePluginAndSave(id)` and `disablePluginAndSave(id)` are the user-action helpers that mutate `enabledPlugins` and persist `community-plugins.json`.
- `setEnable(false)` flips the global community-plugin switch and unloads loaded plugins without deleting `enabledPlugins` or wiping `community-plugins.json`; `setEnable(true)` re-enables the current configured set.

### Settings modal vertical-tab DOM contract

Reverse evidence from original `vte` settings modal:

- The settings modal adds `mod-settings` and `mod-sidebar-layout` to `modalEl` and keeps the base modal title element; the title is updated to `Settings` or the active tab name.
- `contentEl` itself receives `vertical-tabs-container`; there is no extra wrapper between modal content and the vertical-tabs root.
- `contentEl` contains a direct `.vertical-tab-header` and a `.vertical-tab-content-container` for the active setting tab.
- The header contains three fixed `.vertical-tab-header-group` blocks: options, core plugins, and community plugins.
- `data-section` is attached to each `.vertical-tab-header-group-items` container, not the outer group.
- Core and community plugin group titles are hidden when empty, while their item containers remain part of the header structure.
- Setting nav items are created centrally when `tab.navEl` is absent: `.vertical-tab-nav-item.tappable[data-setting-id]`, optional `.vertical-tab-nav-item-icon`, `.vertical-tab-nav-item-title`, and `.vertical-tab-nav-item-chevron` containing the chevron icon.

### Modal base DOM contract

Reverse evidence from original `Modal=tb`:

- The base modal creates `.modal-container` containing `.modal-bg` and `.modal` as direct children.
- `.modal` creates `.modal-close-button.mod-raised.clickable-icon` as a direct child before `.modal-header`, not inside the header.
- `.modal-header` contains `.modal-title`; `.modal-content` follows the header.
- The close button uses the shared icon system with the `x` icon and closes the modal on click.
- Opening toggles `.mod-dim` on `.modal-container` according to `dimBackground` and applies `bgOpacity` to `.modal-bg`; `setBackgroundOpacity()` and `setDimBackground()` are chainable setters.
- The reconstruction keeps `.modal-button-container` on the base modal for compatibility with existing reconstructed modal subclasses, while aligning the close-button/header/content order with the original DOM contract.

## Notice DOM contract

Reverse target: original `Notice` is exported as `fb` and mounted per active window.

Evidence from `app.js`:

- `new Notice(message, timeout = 4000)` resolves `activeWindow` and stores one `.notice-container` per window in a `WeakMap`.
- The outer `.notice-container` is appended to `activeWindow.document.body` only when it is not currently shown.
- `containerEl` is the single `.notice` element created inside the outer container.
- `messageEl` and `noticeEl` both point to the `.notice-message` child created inside `.notice`.
- `setMessage(message)` writes text into `.notice-message` and returns `this`.
- `setAutoHide(timeout)` clears the previous timer, hides after timeout when not hovering, and schedules another hide one second after mouse leave.
- `addButton(text, callback)` lazily creates `.notice-button-container` inside `.notice`, then appends `.notice-cta` children.
- `hide()` removes the single `.notice`; when the outer `.notice-container` has no remaining children, it removes that outer container too.

Reconstruction notes:

- `src/ui/Notice.ts` now exposes `noticesEl` for the outer `.notice-container` while preserving Obsidian's `containerEl` semantics as the single `.notice`.
- `noticeEl` aliases `messageEl`, matching the original property assignment observed in `app.js`.
- Button DOM is now `.notice > .notice-button-container > .notice-cta`, not nested under `.notice-message`.

## Menu/MenuItem DOM contract

Reverse target: original `MenuItem` is minified as `Hg`; original `Menu` is minified as `Ug`.

Evidence from `app.js`:

- `MenuItem` constructor creates `createDiv("menu-item tappable")`, then appends `.menu-item-icon` and `.menu-item-title`.
- There is no default `.menu-item-accelerator` in the original item constructor.
- `MenuItem.setIcon(icon)` renders into `.menu-item-icon`; `removeIcon()` detaches that icon element. No `setAccelerator()` method or `.menu-item-accelerator` class was found in the original MenuItem.
- `MenuItem.setChecked(true)` appends a separate `.menu-item-icon.mod-checked` using `lucide-check` and toggles `.mod-checked` on the item.
- `MenuItem.setDisabled(disabled)` toggles `.is-disabled`; `setWarning(warning)` toggles `.is-warning`; `setIsLabel(label)` toggles `.tappable` and `.is-label`.
- `MenuItem.setSubmenu()` adds `.has-submenu`, creates a child `Menu`, and appends `.menu-item-icon.mod-submenu` with `lucide-chevron-right`.
- `Menu` constructor creates root `.menu`, then `.menu-grabber`, then `.menu-scroll`; it separately creates `.suggestion-bg` with opacity `0`.
- `Menu.showAtPosition()` sorts and renders only when shown, appends `.menu` and `.suggestion-bg` to the document body, and marks `parentEl` with `.has-active-menu` without using it as the DOM parent.
- `Menu.hide()` detaches both `.menu` and `.suggestion-bg` and removes `.has-active-menu` from `parentEl`.

Reconstruction notes:

- `src/ui/Menu.ts` now matches the shell structure `.menu > .menu-grabber + .menu-scroll` and exposes `grabberEl`, `scrollEl`, and `bgEl`.
- `Menu.showAtPosition()` now always appends `.menu` and `.suggestion-bg` to `document.body`; `setParentElement()` only drives `.has-active-menu` on the anchor.
- Menu items no longer expose the invented accelerator extension; plugin-facing API should stay on the observed MenuItem methods.
- Icon, checked, and submenu affordances now render real icon DOM through the shared icon helper instead of only setting ad-hoc dataset values on the item root.

## SuggestModal / EditorSuggest DOM and ownership

Reverse target: `SuggestModal` is minified as `sb`; `FuzzySuggestModal` as `lb`; `EditorSuggest` as `NI`; popover suggest base as `EI`; common suggestion chooser as `ob`.

Evidence from `app.js`:

- Export table maps `SuggestModal:()=>sb`, `FuzzySuggestModal:()=>lb`, and `EditorSuggest:()=>NI`.
- `SuggestModal/sb` removes `.modal`, adds `.prompt`, empties the modal body, then creates `.prompt-input-container`, `input.prompt-input`, `.prompt-input-cta`, `.search-input-clear-button`, and `.prompt-results`.
- `SuggestModal/sb` stores `limit=100`, `emptyStateText`, `isOpen=false`, `inputEl`, `clearButtonEl`, `ctaEl`, `resultContainerEl`, and `instructionsEl=createDiv("prompt-instructions")`.
- `SuggestModal/sb.onOpen()` sets `isOpen=true`, clears the input, focuses it, and calls `updateSuggestions()`.
- `SuggestModal/sb.updateSuggestions()` calls `getSuggestions(inputValue)`, accepts either an array or Promise, applies `limit`, then calls chooser `setSuggestions()` or `onNoSuggestion()`.
- `SuggestModal/sb.selectSuggestion()` updates keymap modifiers, closes, sets `isOpen=false`, and calls `onChooseSuggestion(value,event)`.
- `obsidian.d.ts` exposes `Instruction { command, purpose }` and routes prompt instruction APIs through `setInstructions(instructions: Instruction[])`.
- `ob` owns common suggestion list behavior: `.suggestion-item`, `.suggestion-empty`, `.is-selected`, click/auxclick, mousemove hover selection, wrapping arrow navigation, page navigation, Home/End/Enter, plus mac/iOS `Ctrl-p` and `Ctrl-n`.
- `EI` creates `suggestEl=createDiv("suggestion-container")`, then `suggestInnerEl=suggestEl.createDiv("suggestion")`, then `suggestions=new ob(this, suggestInnerEl, scope)`.
- `EI.open()` pushes the scope, attaches `suggestEl` to `activeDocument.body`, and marks the popover open; `EI.close()` pops the scope, clears suggestions, detaches `suggestEl`, and marks it closed.
- `NI extends EI`; its constructor creates `instructionsEl=createDiv("prompt-instructions")`, stores `context=null`, sets `limit=100`, and prevents mousedown on `suggestEl`.
- `NI.trigger(editor,file,force)` only proceeds for a collapsed selection, calls `onTrigger(cursor, editor, file)`, and stores `context={editor,file,start,end,query}`.
- `NI.showSuggestions(values)` closes on empty values, applies `limit`, calls `suggestions.setSuggestions(values)`, then calls `updatePosition(true)`.
- `NI.updatePosition()` uses `editor.coordsAtPos(start/end)`, opens the popover, then repositions it using the line direction.
- `suggestion-bg` belongs to `Menu/Ug` and combobox/mobile menu flows, not to core `SuggestModal/sb` or `EditorSuggest/NI` list DOM.

Reconstruction notes:

- `src/suggest/EditorSuggest.ts` now extends the existing `PopoverSuggest` base, so each editor suggest instance owns `suggestEl`, `suggestInnerEl`, `suggestions`, and scope state directly.
- `EditorSuggestManager` now coordinates registered suggest instances and delegates display to `EditorSuggest.trigger()`, `showSuggestions()`, and `updatePosition()` instead of creating transient DOM itself.
- Built-in tag, link, and slash-command suggests now call `super(app)` and use the inherited Obsidian-style `app`/popover state.

## AbstractInputSuggest and grouped suggestion chooser

Reverse target: `PopoverSuggest` is minified as `EI`; common chooser as `ob`; grouped chooser as `ab`; `AbstractInputSuggest` as `SI`; combobox as `MI`.

Evidence from `app.js`:

- Export table maps `PopoverSuggest:()=>EI` and `AbstractInputSuggest:()=>SI`.
- `EI` creates `.suggestion-container`, then child `.suggestion`, then `suggestions=new ob(this, suggestInnerEl, scope)`.
- `EI.attachDom()` appends `.suggestion-container` to `activeDocument.body`; `EI.open()` pushes the scope and attaches DOM; `EI.close()` clears suggestions, detaches DOM, and pops the scope.
- `ob` creates flat `.suggestion-item` children, maintains `values`, `suggestions`, and `selectedItem`, and applies `.is-selected`.
- `ab extends ob` overrides `setSuggestions(values)` to create `.suggestion-group` wrappers with `data-group`, grouping consecutive values by their `group` property; each group contains `.suggestion-item` children.
- `SI extends EI`; constructor stores `textInputEl`, binds `autoReposition`, listens to `input`, `focus`, and `blur`, and prevents mousedown on `.suggestion-item`.
- `SI.showSuggestions(values)` closes on empty values, verifies the input is shown, applies `limit`, calls `suggestions.setSuggestions(values)`, opens, and sets auto-destroy on the input.
- `SI.onInputChange()` only runs while `textInputEl` is active, calls `getSuggestions(getValue())`, supports array or Promise results, then calls `showSuggestions()`.
- `MI` is an internal combobox built on `EI`; it adds `.combobox` to `suggestEl`, creates `.combobox-button`, `.combobox-button-icon`, `.combobox-button-label`, `.combobox-clear-button`, `.combobox-button-chevron`, prepends a `SearchComponent`, and filters suggestions.

Reconstruction notes:

- `src/suggest/SuggestModal.ts` now exposes `GroupedSuggestChooser`, matching original `ab` grouped DOM: `.suggestion-group[data-group] > .suggestion-item`.
- `SuggestChooser` keeps its internal `values` and rendered item array as protected state so grouped variants can preserve Obsidian selection and click behavior without duplicating the full chooser.
- Full internal combobox (`MI`) is documented as a later reconstruction layer; it should build on `PopoverSuggest` and `GroupedSuggestChooser`, not be approximated with a native select/dropdown.

## Combobox suggest (`MI`) reconstruction

Reverse target: original combobox is minified as `MI` and extends `EI`.

Evidence from `app.js`:

- `MI extends EI`; constructor adds `.combobox` to `suggestEl`.
- It creates `bgEl=createDiv("suggestion-bg")` with opacity `0` for phone/mobile menu flows.
- It creates `.combobox-button[tabindex=0]` inside the passed parent element.
- Button children are `.combobox-button-icon`, `.combobox-button-label`, `.combobox-clear-button`, and `.combobox-button-chevron`.
- Clear button uses `lucide-x`, prevents mousedown, and clears by selecting `null`.
- Chevron uses `lucide-chevrons-up-down`.
- Button keydown opens on arrow keys or a single character; button click toggles open/close.
- It creates a `SearchComponent` inside `suggestEl`, prepends its `.search-input-container`, and wires `onChange` to `onInputChange(value)`.
- Search input focus toggles `.has-input-focus` on `suggestEl`; Tab from search returns focus to the combobox button.
- `open()` calls base open, adds `.has-focus` to the button, populates suggestions from an empty search query, repositions against the button rect, auto-selects the search input, sets auto-destroy, then calls `onOpen` callback.
- `close()` calls base close, clears `.has-focus`, clears the search input, and calls `onClose` callback.
- `renderSuggestion()` adds `.mod-complex.mod-toggle`, shows `.suggestion-icon.mod-checked` for the current value, optional icon flair, and `.suggestion-content > .suggestion-title` with fuzzy highlighting.
- `getSuggestions(query)` fuzzy-matches item `value`, falls back to `display` with a lower score, sorts descending by score, and returns matching items.

Reconstruction notes:

- `src/suggest/ComboboxSuggest.ts` reconstructs the `MI` DOM contract as a reusable internal control built on `PopoverSuggest` and `SearchComponent`.
- The control is exported from `src/index.ts` for internal app layers that need Obsidian-style comboboxes, especially Bases and toolbar menus.
- This is intentionally not a native `<select>` replacement; it preserves the `.suggestion-container.combobox` shell expected by `app.css`.

## File and folder input suggest subclasses (`xI/TI/DI/AI/PI`)

Reverse target: original file/folder input suggestions are internal subclasses of `AbstractInputSuggest/SI`.

Evidence from `app.js`:

- `xI` is the generic file path input suggest. It extends `SI` and only accepts `TFile` instances from `app.vault.getAllLoadedFiles()`.
- `xI.renderSuggestion()` adds `.mod-nowrap`; markdown files are displayed without the `.md` extension and rendered with fuzzy highlights.
- `xI.getSuggestions(query)` prepares a fuzzy query, applies `filePredicate(file)`, matches against `file.path`, sorts with `Ay`, and caps at `MAX_SUGGESTIONS=100`.
- `xI.filePredicate()` defaults to `true`.
- `xI.selectSuggestion()` sets the input value to the displayed path, triggers `input` and `change`, and closes. It does not call `AbstractInputSuggest.selectSuggestion()`, so `onSelect` callbacks are not invoked by generic file selection.
- `TI` extends `xI` and only overrides `filePredicate(file)` to require `file.extension === "md"`.
- `DI` extends `xI`, stores a constructor predicate, and accepts files when no predicate exists or `predicate(file)` returns true.
- `AI` is the folder input suggest. It extends `SI`, stores `allowNullSelection` and `includeRoot`, reads `app.vault.getAllFolders(includeRoot)`, applies `filePredicate(folder)`, fuzzy-matches `folder.path`, sorts and caps at 100.
- `AI.renderSuggestion(null)` shows `"+ " + this.getValue()`; non-null folder suggestions render the folder path with fuzzy highlights.
- `AI.selectSuggestion()` sets value and triggers only `input` for non-null selections, closes, then calls the base `AbstractInputSuggest.selectSuggestion()` so `onSelect` does fire.
- `PI` extends `AI`, stores `folderPredicate`, and passes its fourth constructor argument only as `allowNullSelection`; it does not add an `includeRoot` constructor parameter.
- `xI/TI/DI/AI/PI` are internal classes; the export table exposes `AbstractInputSuggest:()=>SI`, not these subclasses directly.

Reconstruction notes:

- `src/suggest/FileInputSuggest.ts` reconstructs this internal hierarchy as `FileInputSuggest`, `MarkdownFileInputSuggest`, `FilteredFileInputSuggest`, `FolderInputSuggest`, and `FilteredFolderInputSuggest`.
- `Vault.getAllFolders(includeRoot)` was added so folder suggestions use the same vault-level API shape as original `AI` rather than traversing private internals.
- Event semantics intentionally differ between file and folder suggestions to match the original: file selections trigger `input/change` without `onSelect`; folder selections trigger `input` and then `onSelect`.

## Tooltip API (`displayTooltip` / `setTooltip`)

Reverse target: `displayTooltip` is minified as `kv`; `setTooltip` is minified as `Mv`.

Evidence from `app.js`:

- Export table maps `displayTooltip:()=>kv` and `setTooltip:()=>Mv`.
- `displayTooltip(el, text, options?)` creates a `.tooltip` element in `el.doc.body`; the tooltip text is written directly into `.tooltip`, with no `.tooltip-content` wrapper.
- Each displayed tooltip creates a child `.tooltip-arrow`.
- `placement` defaults to bottom. `left`, `right`, and `top` add `.mod-left`, `.mod-right`, and `.mod-top`; bottom has no modifier class.
- `classes` are added directly to `.tooltip`.
- `gap` defaults to `8`; top placement has an additional offset constant in the original implementation.
- Positioning uses `getBoundingClientRect()`, clamps to body/client viewport bounds, and adjusts `.tooltip-arrow` horizontally.
- `horizontalParent` affects horizontal positioning for `displayTooltip`.
- `setTooltip(el, text, options?)` writes `aria-label`, then optional `data-tooltip-position`, `data-tooltip-classes`, and `data-tooltip-delay`.
- Global pointer listeners use `[aria-label]` as the tooltip trigger. `pointerover` schedules display, `pointerout` and `pointerup` hide.
- Default hover delay is `1000ms`; switching shortly after hide can bypass the delay. CSS variable `--no-tooltip: true` prevents display.
- Obsidian does not export a public `Tooltip` class; this is a function-based global tooltip system.
- `Setting.setTooltip`, `ButtonComponent.setTooltip`, `ExtraButtonComponent.setTooltip`, and `ToggleComponent.setTooltip` call `setTooltip` on their owned DOM element.

Reconstruction notes:

- `src/ui/Popover.ts` now implements `displayTooltip` and `setTooltip` using the original body-mounted `.tooltip > .tooltip-arrow` DOM contract.
- `src/ui/Setting.ts` component tooltip methods now write the Obsidian `aria-label/data-tooltip-*` protocol instead of browser-native `title` attributes.
- `src/api/ObsidianPluginModule.ts` now exposes `setTooltip` and `displayTooltip` to plugin code.

## DOM helper / HTMLElement extension contract

Reverse evidence from original `app.js` shows Obsidian uses a small DOM builder DSL instead of framework components for many shell surfaces:

- `createDiv("drag-reorder-ghost")` accepts class strings directly.
- `createDiv({ cls: "tooltip", text })` accepts object specs with class/text data.
- Parent-scoped builders are used as `parent.createDiv("prompt-instruction", callback)`.
- Object specs support `prepend: true`, for example tab/status icons inserted before existing children.
- Object specs support `parent`, `cls`, `text`, and `attr`, including values such as `contentEditable: false` and `data-*` attributes.
- `createEl("button", "clickable-icon", callback)` and `createEl("input", { type, placeholder })` are common shell-level patterns.
- `createSpan({ cls: "suggestion-highlight", text })` and `createSpan("text-button-icon", callback)` are used by suggest/menu style surfaces.
- Element extensions include `empty`, `detach`, `setText`, class helpers, attribute helpers, delegated `on`, `onClickEvent`, `find`, `findAll`, `doc`, and `win`.

Current reconstruction status:

- `src/dom/dom.ts` now implements `createEl`, `createDiv`, `createSpan`, object/class/callback overloads, parent/prepend insertion, attribute assignment, removal helpers, and prototype installation.
- `src/api/ObsidianPluginModule.ts` exports the same DOM helper surface to plugin code.
- `src/dom/dom.test.ts` covers the object spec, callback builder, prototype builder, delegated events, cleanup, detach, and remove-children behavior.

Design note: this layer should stay structural. Do not use CSS-only rewrites to imitate Obsidian shell layout when the original app creates a different DOM contract.

## App / Workspace shell DOM contract

Reverse evidence from original `app.js` shows the desktop shell is built from DOM helpers rather than a component framework:

- `@3657274`: `AppDom` creates `app-container`, then `horizontal-main-container`, then `workspace`, and a sibling `status-bar` under `app-container`.
- `@3665926`: the app adds `obsidian-app` to `document.body`.
- `@2704200`: desktop workspace order is left ribbon, left split, root split, right split, right ribbon.
- `@2662094`: ribbons use `workspace-ribbon side-dock-ribbon` plus `mod-left` / `mod-right`.
- `@2662395`: only the left ribbon owns `side-dock-actions` and `side-dock-settings`.
- `@1380937`: sidedocks are `workspace-split` variants with `mod-sidedock` and `mod-left-split` / `mod-right-split`.
- `@1380937`: sidedock empty state is `workspace-sidedock-empty-state > p.u-muted`.
- `@1388859`: tabs are `workspace-tabs > workspace-tab-header-container > workspace-tab-header-container-inner`, plus `workspace-tab-container`.
- `@1389549`: new-tab and tab-list buttons wrap their icon in `span.clickable-icon`.
- `@1402400`: tab headers are `workspace-tab-header tappable > workspace-tab-header-inner`, with icon, title, status-container, and close-button in order.
- `@1047800`: views mount through `workspace-leaf-content[data-type]`.
- `@1051200`: `ItemView` creates `view-header` and `view-content`; header internals are `view-header-left`, `view-header-nav-buttons`, `view-header-title-container`, `view-header-title-parent`, `view-header-title`, and `view-actions`.
- `@1053437`: item view actions are `button.clickable-icon.view-action`.

Current reconstruction status:

- `src/app/AppDom.ts` now follows the original four-node app shell and no longer injects a pseudo titlebar into the main `AppDom` path.
- `src/workspace/WorkspaceRibbon.ts` uses the original ribbon/action/sidebar-toggle icon contract.
- `src/workspace/WorkspaceSidedock.ts` restores default width, open/collapsed workspace classes, vault profile placement, and the `p.u-muted` empty-state structure.
- `src/workspace/WorkspaceTabs.ts` restores `span.clickable-icon` wrappers for new-tab and tab-list controls.
- `src/workspace/WorkspaceLeaf.ts` restores tab header construction and removes the extra `clickable-icon` class from the tab close button.
- `src/views/ItemView.ts` restores button-based nav/action controls, `mod-fade` title container, and `lucide-more-vertical` for the more-options action.
- `src/workspace/WorkspaceDomStructure.test.ts` locks the shell/tab/leaf/item-view DOM contract.

## Icon renderer contract

Reverse evidence from original `app.js`:

- `@1010612`: `setIcon`/`tv` checks the first child; if it is already an `SVGSVGElement` with the requested icon class, it reuses it.
- `@1010612`: otherwise it removes the first child, clones an icon SVG, adds `svg-icon` and the icon class, and appends it.
- Exact search found no `data-icon` in the original `app.js`; this reconstruction should treat `data-icon` as an older fallback, not the primary icon contract.

Current reconstruction status:

- `src/ui/Icon.ts` now renders inline `svg.svg-icon.<icon-name>` and supports short lucide aliases such as `x -> lucide-x`.
- `src/api/ObsidianPluginModule.ts` now exports the same SVG-backed `setIcon` to CommonJS plugins.
- `src/ui/Icon.test.ts`, `src/ui/Menu.test.ts`, `src/ui/Modal.test.ts`, and the plugin API test now verify SVG classes instead of `data-icon` / `has-icon` fallback markers.

## Workspace root / floating / popout / frameless / tab-list contract

Reverse evidence from original `app.js`:

- `@1377738`: `WorkspaceSplit` creates `workspace-split` and direction classes such as `mod-vertical` / `mod-horizontal`.
- `@2665033`: `WorkspaceRoot` adds only `mod-root` on top of the split/container base. No `workspace-root` class was found.
- `@2665190`: `WorkspaceFloating` is a logical parent with `type = "floating"`, `allowSingleChild = true`, and `autoManageDOM = false`; it does not render into the main workspace DOM.
- `@2704244`: desktop workspace children are left ribbon, left split, root split, right split, right ribbon. `floatingSplit.containerEl` is not included.
- `@2665381`: `WorkspaceWindow` is a root-like split with `mod-root workspace-window`; new popout window DOM is `body > app-container > horizontal-main-container > workspace > workspace-window`.
- `@2668125`: popout windows close when empty and trigger `window-close` cleanup.
- `@2730079`: `updateFrameless` clears `mod-top`, `mod-top-left-space`, and `mod-top-right-space` from all tab groups, then recomputes top tab groups across root, side docks, and floating windows.
- `@1390056`: tab-list dropdown uses `Menu.addSections(["action", "close", "", "tablist"])`, `menu.dom.addClass("mod-tab-list")`, `setParentElement(trigger)`, stack/unstack, close all, `tab-group-menu`, and checked tab-list entries.

Current reconstruction status:

- `src/workspace/WorkspaceFloating.ts` now behaves as a logical floating container and no longer adds unsupported `workspace-floating` / `mod-floating` classes.
- `src/workspace/Workspace.ts` no longer appends the floating container into desktop/mobile workspace DOM.
- `src/workspace/WorkspaceWindow.ts` now creates a popout app shell with `app-container`, `horizontal-main-container`, `workspace`, and `status-bar`, then appends the `workspace-window` split inside that workspace node.
- `src/workspace/WorkspaceTabs.ts` now implements the original tab-list menu contract with `mod-tab-list`, stack/unstack, close all, `tab-group-menu`, checked active tab entries, and parent `has-active-menu` behavior via `Menu.setParentElement`.
- `src/workspace/Workspace.ts` now implements the core `updateFrameless` class state machine for `mod-top`, `mod-top-left-space`, and `mod-top-right-space` across root, side docks, and floating windows.
- `src/workspace/WorkspacePopoutAndTabList.test.ts` locks the floating/popout/tab-list/frameless DOM contracts.

Design note: animation details and Electron frame button relocation are still deeper frameDom work. The current layer restores the structural class state needed by original `app.css`.

## WorkspaceLeaf tab header context menu contract

Reverse evidence from original `app.js`:

- `@1402625`: tab headers are `workspace-tab-header tappable`, draggable, and bind `dragstart`, `contextmenu`, middle-button `mousedown`, middle-button `auxclick`, and `mouseover` hover-link behavior.
- `@1402910`: the close button is `workspace-tab-header-inner-close-button`; click runs the same close function used by middle-click.
- `@1412165`: `WorkspaceLeaf.onOpenTabHeaderMenu` creates a menu with sections `title`, `close`, `pane`, `open`, `action`, `find`, `info`, `info.copy`, `view`, `view.linked`, `system`, empty section, and `danger`.
- `@1412165`: it configures submenus for `info.copy` and `view.linked`, calls `view.onTabMenu(menu)`, then visible panes call `view.onPaneMenu(menu, "tab-header" | "sidebar-context-menu")`, then `workspace.trigger("leaf-menu", menu, leaf)`, then `menu.setParentElement(tabHeaderEl)`.
- `@1049430`: base `View.onTabMenu` adds close actions. `Close` always detaches current leaf. `Close others`, `Close after`, and `Close all` skip pinned leaves and do not appear in sidebar contexts.
- `@1054473` / `@1055486`: `ItemView`/file-pane menu contributions add split right/down, pin/unpin, link/unlink, and move to new window.
- `@1408902`: pinned and linked group state propagates through `WorkspaceLeaf.setPinned` and `WorkspaceLeaf.setGroup`.

Current reconstruction status:

- `src/workspace/WorkspaceLeaf.ts` now binds tab header `contextmenu`, middle-click suppression, and middle-click close behavior.
- `WorkspaceLeaf.openTabHeaderMenu` now creates the original section contract, configures `info.copy` and `view.linked` submenus, adds core close/pane/open actions, triggers `leaf-menu`, and uses `Menu.setParentElement` so `has-active-menu` is applied.
- Close semantics now distinguish `Close`, `Close others`, `Close tabs to the right`, and `Close all`, preserving pinned sibling tabs for bulk close actions.
- Pane/open actions now expose pin/unpin, link/unlink, split right, split down, and move to new window.
- `src/workspace/WorkspaceTabHeaderMenu.test.ts` locks menu structure, `leaf-menu`, pinned close semantics, pin toggling, and middle-click close behavior.

Design note: original Obsidian splits menu contribution across `View.onTabMenu`, `ItemView.onPaneMenu`, `FileView.onPaneMenu`, and plugin hooks. This reconstruction currently restores the executable core in `WorkspaceLeaf`; a later layer should move those contribution methods onto the view classes while preserving the behavior and tests.

## View / ItemView / EditableFileView menu contribution layering

Reverse evidence from original `app.js`:

- `@1049340`: base `View` has default empty `onPaneMenu(menu, source)` and `onHeaderMenu(menu)` hooks.
- `@1049418`: base `View.onTabMenu(menu)` contributes the close section: close, close others, close after, and close all.
- `@1054471`: `ItemView.onPaneMenu(menu, source)` calls the base hook, then contributes split right/down actions in section `open`.
- `@1055474`: `ItemView.onTabMenu(menu)` calls the base hook, then contributes pin/unpin, link/unlink, and move to new window.
- `@1056343`: `ItemView.onMoreOptionsMenu(menu)` exists as an empty subclass hook.
- `@2312697`: `EditableFileView.onPaneMenu(menu, source)` calls its parent, adds rename/delete file actions, and triggers `workspace.trigger("file-menu", menu, file, source, leaf)`.
- `@1411975`: `WorkspaceLeaf.onOpenTabHeaderMenu` orchestrates menu creation and calls `view.onTabMenu`, visible `view.onPaneMenu`, `workspace.trigger("leaf-menu")`, and `menu.setParentElement(tabHeaderEl)`.
- `@1053848`: view header more-options follows a similar orchestration: `onPaneMenu("more-options")`, `onMoreOptionsMenu`, `leaf-menu`, then `showAtPosition` anchored to the button.

Current reconstruction status:

- `src/views/View.ts` now owns base tab close menu contributions and exposes `onPaneMenu`, `onHeaderMenu`, and `onTabMenu` hooks.
- `src/views/ItemView.ts` now owns split right/down, pin/link/popout tab contributions, and view-header more-options orchestration.
- `src/views/EditableFileView.ts` now owns rename/delete file pane contributions and the `file-menu` hook.
- `src/views/FileView.ts` no longer owns editable rename/delete menu behavior.
- `src/workspace/WorkspaceLeaf.ts` now only orchestrates the tab-header menu through view hooks and `leaf-menu`, instead of directly owning all menu item creation.
- `src/workspace/WorkspaceTabHeaderMenu.test.ts` verifies tab-header menu contribution layering, editable file menu contributions, `file-menu` context, and more-options `leaf-menu` behavior.

Design note: linked-view submenu contributors such as local graph, backlinks, outgoing links, outline, and properties are still a later plugin/builtin layer. The menu hook locations are now in place for them.

## Linked-view file-menu contributors

Reverse evidence from original `app.js`:

- `@2544632`: the local graph plugin listens to `workspace.on("file-menu")`, requires a markdown `TFile`, skips `sidebar-context-menu`, contributes section `view.linked`, icon `lucide-git-fork`, and opens `localgraph` by splitting the source leaf vertically with `{ state: { file }, active: true, group: sourceLeaf }`.
- `@2854374`: backlinks listens to `file-menu`, requires a `TFile`, non-mobile runtime, a source leaf, and non-sidebar source; it contributes `view.linked` with icon `links-coming-in` and opens `backlink` in a horizontal split grouped to the source leaf.
- `@3282878`: outgoing links listens to `file-menu`, requires a markdown file, non-mobile runtime, a source leaf, and non-sidebar source; it contributes `view.linked` with icon `links-going-out` and opens `outgoing-link` in a horizontal split grouped to the source leaf.
- `@3299897`: outline listens to `file-menu`, requires a markdown file, non-mobile runtime, a source leaf, and non-sidebar source; it contributes `view.linked` with icon `lucide-list` and opens `outline` in a vertical split grouped to the source leaf.
- `@3315208`: local file properties listens to `file-menu`, requires a markdown file, non-mobile runtime, a source leaf, and non-sidebar source; it contributes `view.linked` with icon `lucide-info` and opens `file-properties` in a horizontal split grouped to the source leaf.

Current reconstruction status:

- `src/builtin/GraphPlugin.ts` now contributes the linked local graph action through the same `file-menu` hook instead of hard-coding it into workspace menu construction.
- `src/builtin/CorePlugins.ts` now contributes linked backlinks, outgoing links, and outline actions from their builtin plugin definitions.
- `src/builtin/PropertiesPlugin.ts` now contributes linked local file properties from the properties plugin.
- `src/ui/Icon.ts` now includes the Obsidian icon names used by those linked-view entries.
- `src/workspace/WorkspaceTabHeaderMenu.test.ts` verifies the `file-menu -> view.linked -> split grouped leaf` path and the markdown/sidebar-context conditions.

Design note: this preserves the important contract for UI reconstruction: `WorkspaceLeaf` and `ItemView` own the menu DOM scaffolding, while builtin plugins only contribute sectioned actions through events.

## Tab header hover-link and linked group status icon

Reverse evidence from original `obsidian-app.js`:

- `@1403423`: `WorkspaceLeaf` binds `tabHeaderEl.addEventListener("mouseover", ...)` after `contextmenu`, middle-button `mousedown`, and `auxclick`.
- `@1403423`: the mouseover handler only runs when the event is not default-prevented and `Lc(event, tabHeaderEl)` is true; `Lc` means the pointer entered from outside the element, not from a child.
- `@1403627`: it reads `getViewState().state.file`, checks it is a string and `app.vault.getFileByPath(file)` exists, then triggers `workspace.trigger("hover-link", { event, source: "tab-header", hoverParent: leaf, targetEl: tabHeaderEl, linktext: file })`.
- `@1403627`: tab-header hover-link does not pass `sourcePath`; Page Preview consumes missing `sourcePath` as an empty string.
- `@1410321`: linked tab status is `workspace-tab-header-status-icon mod-linked`, starts with icon `lucide-link`, and has unlink tooltip semantics.
- `@1410452`: linked status click unhighlights all leaves in `workspace.getGroupLeaves(group)` and then calls `setGroup(null)` on the clicked leaf.
- `@1410596` / `@1410748`: linked status hover swaps the icon to `lucide-unlink` and highlights all leaves in the group; mouseout swaps back to `lucide-link` and unhighlights them.
- `@1406123`: `WorkspaceLeaf.highlight()` only adds `is-highlighted` to `containerEl`; it does not add the class to the tab header.
- `@1409276`: `setGroupMember(sourceLeaf)` generates a new group id for `sourceLeaf` when it does not already have one, then assigns the current leaf to that group.

Current reconstruction status:

- `src/workspace/WorkspaceLeaf.ts` now emits the original tab-header `hover-link` payload for file-backed leaves.
- `src/workspace/WorkspaceLeaf.ts` now renders linked status icon behavior with `lucide-link` / `lucide-unlink`, group highlight/unhighlight, and unlink click behavior.
- `src/workspace/WorkspaceLeaf.ts` now aligns `highlight()` / `unhighlight()` to the original container-only class contract.
- `src/workspace/WorkspaceLeaf.ts` now creates a fresh group id when `setGroupMember(sourceLeaf)` links against an ungrouped source leaf.
- `src/ui/Icon.ts` now includes `lucide-unlink` for linked status hover.
- `src/workspace/WorkspaceTabHeaderMenu.test.ts` locks tab-header hover-link payload, linked status icon behavior, and container-only highlight semantics.

## WorkspaceTabs stacked and sliding tab contract

Reverse evidence from original `app.js`:

- `@1393380`: `WorkspaceTabs` starts with `type = "tabs"`, `allowSingleChild = true`, `autoManageDOM = false`, `tabHeaderEls = []`, `currentTab = 0`, `hasLockedTabWidths = false`, `isStacked = false`, and `containerEl.addClass("workspace-tabs")`.
- `@1393690`: DOM contract is `workspace-tabs > workspace-tab-header-container > workspace-tab-header-container-inner`, sibling `workspace-tab-container`, plus `workspace-tab-header-new-tab`, `workspace-tab-header-spacer`, and `workspace-tab-header-tab-list` inside the header container.
- `@1393868`: tab header clicks are delegated from `containerEl` using `tabHeaderEls.indexOf(target)`, then `selectTabIndex(index)` and `workspace.setActiveLeaf(leaf, { focus: true })`.
- `@1394160`: `tabsInnerEl` wheel converts vertical wheel delta to horizontal `scrollLeft`.
- `@1394250`: leaving the header container calls `unlockTabWidths()`.
- `@1394300`: `tabsContainerEl` scroll calls `onContainerScroll()`.
- `@1398498`: `setStacked(stacked)` toggles `mod-stacked`, then for non-empty groups calls `updateTabDisplay()`, `scrollIntoView(currentTab)`, and `workspace.requestUpdateLayout()`. It does not directly save or resize.
- `@1399394`: stacked mode reparents nodes into `workspace-tab-container` as `tabHeaderEl, containerEl, tabHeaderEl, containerEl...`; non-stacked mode puts headers back into `tabsInnerEl` and leaf containers into `tabsContainerEl`.
- `@1402827`: `lockTabWidths()` only runs when the header is shown and not stacked; it records current tab header client widths into inline `style.width`.
- `@1403134`: `unlockTabWidths()` clears locked widths.
- `@1403575`: `updateSlidingTabs()` computes stacked tab header `left/right`, leaf `left`, and leaf `minWidth/maxWidth` from header widths and container width.
- `@1404286`: `onContainerScroll()` marks offscreen non-current stacked leaves with `is-hidden`.
- `@1404687`: `scrollIntoView(index)` scrolls the stacked container so the selected pane stays visible.
- `@1402408`: tab header close path locks widths before closing a non-last tab and unlocks widths before closing the last tab.
- `@2725601`: `mod-active` belongs to `Workspace.setActiveLeaf`, not `WorkspaceTabs.updateTabDisplay`.

Current reconstruction status:

- `src/workspace/WorkspaceTabs.ts` now tracks `tabHeaderEls` and `hasLockedTabWidths`.
- `src/workspace/WorkspaceTabs.ts` now reparents stacked tabs into the original interleaved `tabHeaderEl + leaf.containerEl` DOM order and restores non-stacked DOM order.
- `src/workspace/WorkspaceTabs.ts` now implements `lockTabWidths`, `unlockTabWidths`, `updateSlidingTabs`, `onContainerScroll`, and `scrollIntoView`.
- `src/workspace/WorkspaceTabs.ts` now leaves `mod-active` ownership to `Workspace.setActiveLeaf`.
- `src/workspace/WorkspaceLeaf.ts` now uses the original close path for tab header close/middle-click, locking or unlocking tab widths before detaching.
- `src/workspace/WorkspacePopoutAndTabList.test.ts` locks stacked DOM reparenting, sliding style computation, offscreen `is-hidden`, and close width lock/unlock behavior.

## WorkspaceTabs tab-header drop contract

Reverse evidence from original `app.js`:

- `@1395974`: `WorkspaceTabs` registers `app.dragManager.handleDrop(tabHeaderContainerEl, ...)`.
- `@1395974`: this handler only accepts drag source types `file`, `files`, `link`, and `bookmarks`; leaf/tab dragging is not handled here.
- `@1401815`: `getTabInsertLocation(clientX)` returns `{ rect, index, droppedIndex }`; `droppedIndex` is set when the pointer is within the center 25 percent of a tab header, while `index` is the insertion position and `rect` is the insertion overlay.
- `@1395974`: `link` drops open into an existing tab only when `droppedIndex !== null` and the target leaf `canNavigate()`; otherwise they insert one new `WorkspaceLeaf` at `index` and call `openLinkText(linktext, sourcePath, { active: true })`.
- `@1395974`: `file` and `files` drops filter to `TFile`; a single file can open into an existing navigable tab, while multiple files insert new tabs.
- `@1395974`: multi-file drops first create all leaves in order, then sequentially `await openFile(file, { active: false })`, then `workspace.setActiveLeaf(lastLeaf, { focus: true })`.
- `@1395974`: `bookmarks` drops require the bookmarks plugin, filter to `file` and `graph` bookmark items, use `openBookmarkInLeaf(item, leaf, { active: true })`, and do not handle multi-bookmark drops into an existing tab center.
- `@1398217`: insertion-preview drops call `dragManager.showOverlay(rect)` and return `{ action: openAsTab, dropEffect: "copy" }`.
- `@1395974`: existing-tab drops return `{ hoverEl: leaf.tabHeaderEl, hoverClass: "is-highlighted", action: openInThisTab, dropEffect: "move" }`.
- `@2713905`: leaf/tab dragging goes through `workspace.onDragLeaf` and the workspace-level movement path, not this tab-header source handler.

Current reconstruction status:

- `src/workspace/WorkspaceTabs.ts` now registers the tab-header drop target with `DragManager.handleDrop`.
- `src/workspace/WorkspaceTabs.ts` now handles `file`, `files`, `link`, and `bookmarks` source types using the original `droppedIndex` versus insertion `index` split.
- `src/workspace/WorkspaceTabs.ts` now keeps leaf dragging out of this handler and leaves it to the workspace movement path.
- `src/drag/DragManager.ts` now consumes `DragDropResult.action` through a `.drag-ghost-action` element, applies `dropEffect` only when the original `effectAllowed` mapping permits it, and clears action text, hover classes, and overlay previews on invalid hover, dragleave, drop, and source cleanup.
- `src/builtin/Bookmarks.ts` now exposes `openItemInLeaf(item, leaf, openState)` so bookmark drops can target a specific leaf like the original `openBookmarkInLeaf`.
- `src/workspace/WorkspacePopoutAndTabList.test.ts` verifies single-file center drops into an existing tab and multi-file insertion into new tabs with final active leaf selection.

## Workspace leaf/tab drag path

Reverse evidence from original `app.js`:

- `@1403121`: leaf tab headers bind `dragstart` to `workspace.onDragLeaf(event, leaf)`.
- `@2709134`: `Workspace.onDragLeaf(event, leaf)` keeps the source leaf in the closure; it does not identify the dragged leaf through the generic `DragManager` source object.
- `@2709359`: leaf drag writes only an empty `text/plain` payload to `dataTransfer`; the original path does not set `effectAllowed = "move"` here.
- `@2709725`: leaf drag creates a `drag-ghost mod-leaf` and later a `workspace-fake-target-overlay` / `workspace-fake-target-container` for edge-split previews.
- `@2714662` / `@2714828`: `onDragLeaf` registers window-level `dragover`, `dragenter`, `dragleave`, `dragend`, and `drop` handlers while the drag is active.
- `@2715563`: `getDropLocation(event)` resolves root, sidedock, tab group, split, or leaf targets from the pointer location.
- `@2716385`: `getDropDirection(event, rect, blockedSides, item)` uses the nearest edge with a `.33` threshold, special-cases tab header top zones, and suppresses stacked left/right splits when not over the tab header container.
- `@1397188`: center drops into `WorkspaceTabs` use `WorkspaceTabs.getTabInsertLocation(clientX).index` for tab movement/reordering.
- `@1541570`: the active leaf-drag preview uses `.workspace-drop-overlay` appended to the current document body with `transform`, `width`, and `height` styles.
- `@2714828`: drop execution covers center tab insertion/reordering, edge split, center swap, empty-target replacement, sidedock moves, and popout/floating cases.

Current reconstruction status:

- `src/workspace/Workspace.ts` now keeps the source leaf in the `onDragLeaf` closure for the window-level drag path.
- `src/workspace/Workspace.ts` now writes only empty `text/plain` for leaf drag and leaves generic source tracking out of this path.
- `src/workspace/Workspace.ts` now computes a drop target with `side`, `tabInsertIndex`, and an overlay rectangle derived from either `WorkspaceTabs.getTabInsertLocation` or edge-band sizing.
- `src/workspace/WorkspaceDragManager.ts` now owns a workspace `.workspace-drop-overlay` and cleanup helpers for leaf-drag previews.
- `src/workspace/Workspace.ts` now shows overlay previews during window `dragover`, sets `body.is-grabbing` after the original 5px movement threshold, executes movement on window `drop`, and clears overlay/body state on cleanup.
- `src/workspace/WorkspaceSplit.test.ts` verifies the real `tabHeaderEl dragstart -> window dragover -> window drop` chain, empty `text/plain`, no source `is-being-dragged` class, overlay sizing, and cleanup.

Design note: mobile touch handling, side-dock group clearing, cross-window floating moves, and popout-on-dragend remain deeper leaf-drag layers. The current layers restore the key desktop workspace-level event path, overlay contract, ghost DOM, and fake-target clone preview without mixing leaf movement into the generic file/link/bookmark `DragManager` source flow.


## Workspace leaf drag ghost and fake target preview

Evidence from original `app.js`:

- `@1403121`: tab header dragstart calls `workspace.onDragLeaf(event, leaf)`.
- `@2709359`: drag data only writes empty `text/plain`.
- `@2709416`: desktop leaf drag creates `.drag-ghost.mod-leaf`, with `.drag-ghost-icon` using `leaf.getIcon()` and a title truncated to 60 characters.
- `@2709624`: desktop appends the ghost to `event.doc.body`, calls `setDragImage(ghost, 0, 0)`, then detaches it asynchronously.
- `@2709736` and `@2711696`: edge split preview uses `.workspace-fake-target-overlay` inside `.workspace-fake-target-container`.
- Fake preview clones `target.containerEl.cloneNode(true)`, hides the original target with `style.opacity = "0"`, and restores opacity on center/invalid/cleanup.
- Fake preview preserves the target ancestor class chain by wrapping the overlay in divs copied from each parent up to `document.body`; this is needed so cloned workspace items inherit the same layout semantics.
- Center/tab insertion only shows `.workspace-drop-overlay`; edge splits show both the edge strip and the fake target preview for the squeezed remainder.

Local reconstruction status:

- `WorkspaceDragManager.createLeafDragGhost` now builds the faithful desktop ghost DOM.
- `WorkspaceDragManager.showFakeTargetPreview` now creates the fake target container, wraps the overlay with copied ancestor classes, clones the target workspace container, toggles `is-in-sidebar`, and writes the fixed preview rect.
- `Workspace.onDragLeaf` wires the drag lifecycle: thresholded `is-grabbing`, drop overlay, fake preview, cleanup, and source opacity restore.
- `WorkspaceSplit.test.ts` covers the real tab-header dragstart -> window dragover -> window drop chain, including ghost DOM, fake preview DOM, opacity hiding/restoring, overlay cleanup, and leaf movement.

## Workspace leaf drag active window session

Evidence from original `app.js`:

- `@2714662` / `@2714828`: active leaf drag registers window-level `dragover`, `dragenter`, `dragleave`, `dragend`, and `drop` listeners. The session is not attached to the source tab header after `dragstart`.
- `@2714828`: cleanup removes the window listeners, removes the drop overlay, removes fake target DOM, restores fake source opacity, detaches the ghost if still present, and removes `body.is-grabbing`.
- Popout/floating evidence implies the body state belongs to the drag event's document, not always the main application document.

Local reconstruction status:

- `Workspace.onDragLeaf` now registers `dragenter` and `dragleave` in addition to `dragover`, `drop`, and capture `dragend`.
- `dragenter` declares the move drop effect without drawing a preview; `dragover` remains responsible for thresholding, overlay, and fake target preview.
- `dragleave` clears overlay/fake preview and restores target opacity when the drag leaves the active document.
- `Workspace.onDragLeaf` now appends the desktop ghost and toggles `is-grabbing` on the drag session's owner document body.
- `WorkspaceDragManager.finishDrag` also clears `is-grabbing` from the source leaf's owner document body for the older generic helper path.
- `Workspace.onDragLeaf` now registers the active drag session on the drag owner window plus existing `WorkspaceWindow.win` instances from `floatingSplit.children`, so a leaf drag can be completed inside an already-open popout/floating window.
- Leaf-drag preview rendering now prefers `target.ownerDocument` for `.workspace-drop-overlay`, preventing popout/floating targets from drawing the overlay into the main document.
- Drag threshold state applies `body.is-grabbing` to every window participating in the drag session and cleanup removes it from every participating document body.
- The drag owner window is resolved from `leaf.tabHeaderEl.ownerDocument.defaultView` before falling back to the event view, so a popout-origin drag does not depend on the event helper's `view`.
- The active session window set now includes the main root window, the owner window, and every open `WorkspaceWindow.win`; this supports both main-to-popout and popout-to-main drag paths.
- Drag cleanup captures session documents at dragstart time. This avoids reading `sessionWindow.document` after a drop moves the last leaf out of a popout and closes that `WorkspaceWindow`.

## Workspace leaf drop location shape

Evidence from original `app.js`:

- `@2715563`: `getDropLocation(event)` resolves a structured location from the pointer, not only a target leaf. The original path accounts for root, sidedock, tab group, split, leaf, floating window, and special targets.
- `@2716385`: `getDropDirection(event, rect, blockedSides, item)` uses a `center/top/right/bottom/left` direction, nearest-edge `.33` threshold, `blockedSides`, tab-header top-zone handling, and stacked-tab left/right suppression.
- `@1397188`: `WorkspaceTabs.getTabInsertLocation(clientX)` returns `{ rect, index, droppedIndex }`; leaf movement uses `index`, while `droppedIndex` is mainly for file/link/bookmark drops into an existing tab.

Local reconstruction status:

- `WorkspaceDropTarget` now carries `item`, `tabs`, `tabInsert`, `ownerWindow`, and `ownerDocument` in addition to the existing `leaf`, `side`, overlay, and fake-target fields.
- `moveLeafIntoTabGroup` now prefers `target.tabInsert.index`, keeping the original `getTabInsertLocation` object as the semantic source of tab insertion.
- `getDropDirectionFromEvent` now has the original-style `blockedSides` and `item` entry point while preserving the existing `.33` threshold, tab-header top-zone handling, and stacked-tab left/right suppression.
- `getLeafDropTargetFromEvent()` now builds its internal `WorkspaceDropTarget` from an original-style `getDropLocationFromEvent()` pass instead of global leaf rect scanning.
- `getDropLocationFromEvent()` follows the original branch order: popout/floating window event target first, then left/right ribbon and sidebar toggle buttons, then left/right sidedock, then root split, otherwise `null`.
- `recursiveGetDropTarget()` mirrors original `recursiveGetTarget(event, parent)`: it walks child order, returns `WorkspaceTabs` as a first-class drop item, recurses through workspace parents/splits, and returns leaves only when they are direct child targets.
- Empty sidedock containers and ribbon/sidebar-toggle hits can return the sidedock root itself. Direct sidedock drops insert into the first existing `WorkspaceTabs` when present, or create one when the sidedock is empty.
- Direct drops onto a collapsed sidedock use the corresponding sidebar toggle button rect for the overlay preview, matching the original preview branch that replaces the sidedock container rect with `leftSidebarToggleButtonEl` / `rightSidebarToggleButtonEl` when the target split is collapsed.
- Root, split, and existing popout/window whitespace are not treated as original drop targets. If the pointer is inside a root/window container but not inside a child item, the reconstructed location returns `null`.
- `WorkspaceSplit.test.ts` covers expanded empty sidedock container drops, collapsed sidedock toggle overlay rects, popout whitespace being ignored without a child target, and cross-document popout drops onto a real tab group/leaf target.
- Remaining gap: this is still not the full original drag/drop model. Mobile-specific drawer behavior and any desktop-only Electron drag affordances not covered by the current tests still need separate evidence.

Floating/window structure evidence from local reconstruction:

- `openPopoutLeaf()` uses `createLeafInFloatingSplit()`, producing `workspace.floatingSplit -> WorkspaceWindow -> WorkspaceTabs -> WorkspaceLeaf`.
- `WorkspaceFloating` has `allowSingleChild = true` and `autoManageDOM = false`; it is a logical container, not the DOM root to hit-test for popout drops.
- `WorkspaceWindow` creates its own `body > .app-container > .horizontal-main-container > .workspace > .workspace-window` shell and inherits normal `WorkspaceParent.appendChild`, so appended `WorkspaceTabs` are DOM children of `WorkspaceWindow.containerEl`.
- `WorkspaceWindow` now builds its shell with `this.doc.createElement()` rather than `body.createDiv()`, so separate popout documents do not depend on DOM prototype helpers installed on the main document.
- `WorkspaceSplit.test.ts` covers dragging from the main workspace into an iframe-backed `WorkspaceWindow.win`, proving drag listeners are registered on the popout window, overlay is appended to the popout document body, `is-grabbing` is cleaned from both documents, and the moved leaf's header/content DOM is adopted into the popout document.
- `WorkspaceSplit.test.ts` also covers dragging from an iframe-backed `WorkspaceWindow` back into the main workspace root. It proves the main window is part of the popout-origin drag session, the overlay is drawn in the main document, the leaf header/content DOM is adopted back into the main document, and the now-empty popout triggers `window-close` and removes its app shell.
- `WorkspaceFloating.openPopout()` / `closePopout()` are the semantic entry points for the `.is-popout-window` state class. `WorkspaceWindow.close()` now calls `floatingSplit.closePopout()` only after the last `WorkspaceWindow` child is removed.
- CSS evidence: `.mod-macos.is-popout-window` changes frame spacing, and frameless/top-right chrome rules explicitly distinguish `:not(.is-popout-window)`. This makes the class part of popout window chrome state, not a disposable implementation detail.
- `WorkspaceLeaf.test.ts` locks the state class for both command-created popout windows and multi-popout lifecycle: closing one of two popouts keeps `.is-popout-window`; closing the last one clears it.

## Workspace popout document ownership

Evidence from local reconstruction:

- `createEl()` now chooses the owner document with `getNodeDocument(parent)` when a parent is supplied, and falls back to `getActiveDocument()` only for parentless creation. This preserves parent ownership across iframe/popout realms.
- `isDomParent()` no longer depends on `value instanceof Node`, because iframe/popout DOM nodes live in a different JavaScript realm and fail the main-window `Node` check.
- `WorkspaceItem` now accepts an explicit `ownerDocument` and creates both `containerEl` and `resizeHandleEl` from that document. `WorkspaceLeaf`, `WorkspaceTabs`, `WorkspaceSplit`, `WorkspaceContainer`, `WorkspaceRoot`, `WorkspaceFloating`, and `WorkspaceWindow` propagate this owner document through their constructors.
- `WorkspaceWindow` passes `win.document` to its `WorkspaceRoot` base class and installs DOM helper extensions on the popout window. Its app shell still uses `this.doc.createElement()`.
- Workspace creation paths now use the target container document: root/default layout uses `rootSplit.containerEl.ownerDocument`; side leaves use the sidedock/drawer document; tab creation uses the tab group document; split creation uses the source item document; popout creation uses `workspaceWindow.doc`.
- `WorkspaceTabs` creates new-tab and drop-created leaves in `this.containerEl.ownerDocument`, so file/link/bookmark drops inside a popout tab group do not create main-document leaves.

Tests:

- `dom.test.ts` verifies parentless creation follows `setActiveWindow()`, parent-supplied creation wins over active document, and cross-realm iframe parents are recognized.
- `WorkspaceSplit.test.ts` verifies iframe-backed `WorkspaceWindow` container/resize/app shell ownership, moving a main leaf into a popout creates the new `WorkspaceTabs` in the popout document, and `createLeafBySplit()` inside a popout creates both the new leaf and tab wrapper directly in the popout document.

## Workspace leaf center drop onto empty target

Evidence from reverse notes:

- `@2714828`: drop execution includes an empty-target replacement branch in addition to center tab insertion/reordering, edge split, center swap, sidedock moves, and popout/floating cases.
- Empty target replacement is not equivalent to ordinary tab insertion: the empty target leaf should be removed rather than left behind as an extra tab.
- `WorkspaceTabs` has `autoManageDOM = false`, so replacement inside a tab group must use `WorkspaceTabs.insertChild()` / `removeChild()` instead of generic `WorkspaceParent.replaceChild()`. Otherwise the tab header/content DOM contract can diverge from the logical children.

Local reconstruction status:

- `moveLeafToDropTarget()` now checks `target.side === "center"` plus `target.leaf.view.getViewType() === "empty"` before ordinary tab insertion or swap.
- `replaceEmptyTargetLeaf()` moves the source leaf into the empty target position, removes the empty target leaf, selects the moved source tab, activates the moved source leaf, and requests resize.
- For `WorkspaceTabs`, replacement uses `insertChild()` followed by `removeChild(emptyLeaf)` so both tab header DOM and leaf container DOM stay aligned with the logical tab list.
- `WorkspaceSplit.test.ts` covers dragging a real file leaf onto an empty target leaf center and asserts the empty leaf is detached from both logic and DOM while the source leaf remains in the target tabs and becomes active.

## Workspace leaf drop blocked sides

Evidence from reverse notes:

- `@2716385`: original `getDropDirection(event, rect, blockedSides, item)` accepts a `blockedSides` argument in addition to nearest-edge direction and item context.
- `blockedSides` means the closest edge is not always a valid split target; the result can fall back to another allowed direction or center behavior.
- Original `onDragLeaf` defines the blocked side helper as `target instanceof FD ? ["left", "right", "top", "bottom"] : inSidedock ? ["left", "right"] : null`, so sidedock targets block both horizontal directions, not only the outward edge.
- Original export evidence maps `WorkspaceSidedock` to `FD` (`WorkspaceSidedock:()=>FD`), and the `FD` constructor adds `mod-sidedock`, `mod-left-split` / `mod-right-split`, `collapsed`, and `side`. Therefore `target instanceof FD` corresponds to a desktop `WorkspaceSidedock`.

Local reconstruction status:

- `getDropDirectionFromEvent()` now receives `blockedSides` from `getBlockedDropSidesForRoot(root)` instead of leaving the option unused.
- Desktop `WorkspaceSidedock` now blocks all four edge directions. This matches the original `target instanceof FD` branch.
- Non-desktop side panes still keep the previous `left/right` fallback until mobile drawer evidence is modeled separately.
- If a side edge is blocked in a sidedock, direction resolution falls back into the existing center path, which can insert into a tab group.
- `WorkspaceSplit.test.ts` covers dragging over outer, inner, and top edges of sidedock tab groups: no side/top split is created, the source leaf remains inside the corresponding sidedock, and the existing side tab group receives the source as a tab.

Remaining gap:

- Mobile drawer blocked-side behavior is not yet proven from original mobile-specific paths.
- Priority reverse offsets for the next layer: `@2715563` (`getDropLocation(event)`), `@2716385` (`getDropDirection(event, rect, blockedSides, item)`), `@2714828` (drop execution), and `@1397188` (`WorkspaceTabs.getTabInsertLocation` file/link/bookmark `droppedIndex` behavior).

## Workspace leaf drop tab-header top zone

Evidence from reverse notes:

- `@2716385`: original `getDropDirection(event, rect, blockedSides, item)` includes a tab-header top-zone special case in addition to nearest-edge distance and `.33` threshold handling.
- `@1397188`: center drops into `WorkspaceTabs` use `WorkspaceTabs.getTabInsertLocation(clientX).index` for tab movement/reordering.

Local reconstruction status:

- `getDropDirectionFromEvent()` allows a tab-group `top` split only when the pointer is within the top third of `tabs.tabHeaderContainerEl`.
- Pointer positions in the rest of the tab header return `center`, which flows into `WorkspaceTabs.getTabInsertLocation(clientX)` for tab insert/reorder rather than creating a top split.
- `WorkspaceSplit.test.ts` covers both zones: lower/header non-top-third drag reorders tabs without fake target preview, while top-third drag shows edge/fake preview and creates a horizontal top split.

## Workspace leaf drop stacked-tab side suppression

Evidence from reverse notes:

- `@2716385`: original `getDropDirection(event, rect, blockedSides, item)` includes stacked tab left/right suppression in addition to nearest-edge threshold, blocked sides, and tab-header top-zone handling.
- `@1397188`: center drops into `WorkspaceTabs` use `WorkspaceTabs.getTabInsertLocation(clientX).index`, so suppressed side edges flow back into tab insert/reorder behavior.

Local reconstruction status:

- `getDropDirectionFromEvent()` returns `center` when a stacked tab group receives a `left` or `right` candidate and the pointer is not inside `tabs.tabHeaderContainerEl`.
- If the pointer is inside the stacked tab header container, left/right edge candidates are still allowed unless blocked by `blockedSides` or the `.33` threshold.
- `WorkspaceSplit.test.ts` covers both paths: stacked content-area side edges reorder/insert without fake target preview, while stacked header side edges show fake target preview and move the source leaf into a side split.

## WorkspaceTabs tab-header `droppedIndex`

Evidence from original `app.js`:

- `@1397188`: `WorkspaceTabs.getTabInsertLocation(clientX)` returns `{ rect, index, droppedIndex }`. `index` is the insertion point for new tabs; `droppedIndex` is the existing tab index when the pointer is strictly inside the middle 50% of a tab header.
- The original uses a strict threshold: `Math.abs(clientX - middle) / width < .25`. Exactly at the 25% boundary is not a dropped tab; just inside that boundary is.
- The function subtracts `5` from `rect.x` after choosing the insertion rect. This also applies to the default tab-header-container rect when the group has no children.
- In the tab header drop handler, single `link` and single `file` drops open in the existing tab only when `droppedIndex !== null` and the target leaf `canNavigate()`.
- For `bookmarks`, a single item with `droppedIndex !== null` opens in the existing tab only when the target leaf can navigate. If the single target leaf cannot navigate, original code falls through and creates a new tab using `index`.
- Multiple bookmarks with `droppedIndex !== null` return without handling, because several bookmarks cannot be opened into one existing tab. Multiple files do not use `droppedIndex`; they create consecutive new tabs from `index`.

Local reconstruction status:

- `WorkspaceTabs.getTabInsertLocation()` now preserves the original strict center-zone threshold and default `rect.x - 5` behavior.
- `WorkspaceTabs.handleTabHeaderDrop()` uses `droppedIndex` for single file/link drops into navigable existing tabs, and otherwise inserts new tabs from `index`.
- `WorkspaceTabs.handleBookmarksDrop()` now matches original fallthrough semantics: multiple centered bookmarks are rejected; a single centered bookmark opens the existing tab only if it can navigate; a single centered bookmark over a non-navigable tab creates a new tab at `index`.
- `WorkspacePopoutAndTabList.test.ts` covers direct `index` / `droppedIndex` threshold behavior, empty tab group rect offset, single file center drops, multiple file tab insertion, single bookmark center drops, pinned/non-navigable bookmark fallthrough, and multiple centered bookmark rejection.

## Workspace leaf drop child-order target resolution

Evidence from original `app.js`:

- `@2715563`: `getDropLocation(event)` first checks `event.win` against `floatingSplit.children` and, for a matching `WorkspaceWindow`, calls `recursiveGetTarget(event, workspaceWindow)`.
- The main-window branch checks ribbon/sidebar toggles, left/right sidedocks, then root split. Root and non-empty sidedocks call `recursiveGetTarget(event, parent)`.
- `recursiveGetTarget(event, parent)` iterates `parent.children` in order. If `Bv(event, child.containerEl)` is false, the child is skipped. If the child is `WorkspaceTabs`, it returns that tab group; if the child is another workspace parent, it recurses; otherwise it returns the child leaf.
- `Bv(event, el)` is a coordinate/rect check: `clientX/clientY` against `el.getBoundingClientRect()`. It does not call `elementFromPoint()`.

Local reconstruction status:

- `getDropLocationFromEvent()` and `recursiveGetDropTarget()` now model this child-order behavior. `WorkspaceTabs` remains a first-class drop item, so tab reorder and edge split can act on the whole tab group.
- `moveLeafToDropTarget()` now treats only `target.item === sourceLeaf` as a self-drop. This allows same-tab-group reorder and tab-group edge splitting even when the active child leaf is the dragged leaf.
- Edge splitting now splits against `target.item` when that item is `WorkspaceTabs`, matching the original drop branch that calls `splitLeaf(i, newTabs, direction, before)` with `i` as the drop location item.
- `WorkspaceSplit.test.ts` covers overlapping drop locations with original child-order hit testing: the first matching child wins rather than `elementFromPoint()`.

Remaining gap:

- The reconstruction keeps a test-only-compatible fallback where a child rect match can stand in for an unset parent rect. In a real browser this is equivalent because a visible child is contained by its parent rect; it exists only because many unit tests stub child rects without stubbing every ancestor.

## File explorer external folder file drops

Reverse source evidence:

- `DragManager.handleDrop` around byte offset `1545255`: the third argument enables external drops, but the callback still receives the internal draggable object; Obsidian does not convert external `DataTransfer` payloads into `DragSource`.
- `kP` around byte offset `1538364`: external file detection scans `DataTransfer.items` for `kind === "file"`.
- `CP` around byte offset `1538503`: external file payload extraction produces temporary dropped-file records with name/path/data metadata, not `DragSource` values.
- `File explorer folder` around byte offset `3240871`: when no internal drag source is present and `DataTransfer` has files, Obsidian imports attachments into the target folder.
- `WorkspaceTabs` around byte offset `1395979` and `ItemView`/`WorkspaceLeaf` around byte offsets `1057892`/`1417476`: generic tab and leaf drop handlers do not pass the external-drop flag, so external files are ignored there.

Reconstruction notes:

- `src/builtin/FileExplorerView.ts` now registers folder and vault-root title elements as explicit external drop zones with `allowExternal = true`.
- If a normal internal `DragSource` exists, the file explorer folder import path returns `undefined` and does not consume the event.
- External file records are consumed locally from `DataTransfer.items`, saved with `Vault.createBinary`, and placed directly under the folder that received the drop.
- Duplicate names use the same `Vault.getAvailablePath` numbering behavior as other vault file creation paths.

## Canvas external drop contract

Reverse source evidence:

- `@3075731`: Canvas registers its wrapper with `app.dragManager.handleDrop(..., true)`, so external drops are admitted by the same drag manager contract rather than by a separate bare drop listener.
- `@1545255`: `DragManager.handleDrop` passes the current internal draggable source to the callback; with external drops the source remains empty instead of being converted from `DataTransfer`.
- `@3076715`: the Canvas external branch first checks `kP(event.dataTransfer)` for file items.
- `@3076747`: external Canvas files call `app.importAttachments(CP(dataTransfer, "drop", true), null)` and then `createFileNodes(importedFiles, posFromEvt(event))`.
- `@3084634`: `createFileNodes(files, pos)` lays file nodes out from the drop point using default file node dimensions, horizontal/vertical gap `45`, and `index % 10` / `Math.trunc(index / 10)` grid placement.
- `@3076893`: if no files are present, Canvas reads only `text/plain`.
- `@3076949`: URL-like `text/plain` creates a centered link node and returns a link drop effect.
- `@3077068`: non-empty non-URL `text/plain` creates a centered text node and returns a copy drop effect.

Reconstruction notes:

- `src/builtin/CanvasView.ts` now registers the canvas wrapper with `DragManager.handleDrop(..., true)` and only consumes the external branch when there is no internal `DragSource`.
- External Canvas file drops are saved through the vault attachment path rules using the current canvas file as the source file, then inserted as `file` nodes.
- `src/canvas/Canvas.ts` now exposes batch file-node creation with the original 10-column, 45px-gap grid formula.
- Canvas URL/text drops now follow the original MIME boundary: `text/plain` is authoritative; `text/uri-list` and `text/html` are not read by the Canvas drop handler.
- The internal Canvas `file` / `files` / `folder` / `link` DragSource branches remain a separate reconstruction layer; this layer deliberately corrected the external branch without inventing partial internal behavior.

## Canvas internal DragSource drop contract

Reverse source evidence:

- `@3070800`: Canvas registers `app.dragManager.handleDrop(wrapper, callback, true)`; callback receives `(event, source, hovering)`.
- `@3071018`: when an internal source exists, Canvas does nothing on the hover phase except return a copy drop effect; node creation happens only when `hovering` is false.
- `@3071018`: internal `file` and resolved `link` sources both create a `file` node at `posFromEvt(event)` and focus the wrapper.
- `@3071138`: internal `files` sources expand direct files and recurse through folders, dedupe via `Set`, sort by `basename`, call `createFileNodes(files, posFromEvt(event))`, clear selection, select the created file nodes, request save, and focus the wrapper.
- `@3071565`: internal `folder` sources recurse children, keep only files, sort by `basename`, call `createFileNodes(files, posFromEvt(event))`, request save, and focus the wrapper.
- `@3084634`: `createFileNodes(files, pos)` uses the top-left drop point and lays nodes out with default file node dimensions plus a 45px gap and 10 columns.
- `@3079501`: `posFromEvt(event)` maps the DOM event coordinates into canvas coordinates before node creation.

Reconstruction notes:

- `src/builtin/CanvasView.ts` now handles internal `file`, `link`, `files`, and `folder` drag sources before falling through to the external `DataTransfer` branch.
- Resolved `link` drag sources create file nodes, matching the original branch that reads `source.file`; unresolved link sources only return the copy affordance and do not create a node.
- `files` drops recursively expand folder entries, dedupe by file object, sort by basename, create the original-style grid of file nodes, and select the created nodes.
- `folder` drops recursively expand and sort descendants but do not replace the previous selection, matching the original branch's lack of explicit `select` calls.
- `src/canvas/Canvas.ts` now exposes selection helpers needed to mirror the `files` branch without leaking selection mutation into `CanvasView` internals.

## Shared attachment import API

Reverse source evidence:

- `@1538503`: `CP(dataTransfer, "drop" | "clipboard", includeData)` extracts dropped attachment records with `name`, `filepath`, `extension`, and `data` fields.
- `@3720945`: `App.prototype.importAttachments(records, folder)` is the shared import path used by Canvas, file explorer, and other explicit external file drop zones.
- `@3721677`: `App.prototype.saveAttachment(name, extension, data)` saves through `vault.getAvailablePathForAttachments(...)` using the active file as the attachment-location source.
- `@1356208`: `Vault.getAvailablePathForAttachments(...)` owns the configured attachment-folder rules and duplicate filename selection.
- Canvas calls `app.importAttachments(CP(dataTransfer, "drop", true), null)`, so it follows normal attachment-location config.
- File explorer folder drops call `app.importAttachments(CP(dataTransfer, "drop", true), folder)`, so they save directly into the target folder and bypass attachment-location config.

Reconstruction notes:

- `src/app/AttachmentImport.ts` now centralizes `DataTransfer.items` to attachment-record conversion using the original-style `name`, `extension`, `filepath`, and `data` shape.
- `src/vault/FileManager.ts` now owns `resolveAttachmentFile`, `importAttachments`, `saveAttachment`, and target-folder attachment saving.
- `src/app/App.ts` exposes thin `resolveAttachmentFile`, `importAttachments`, and `saveAttachment` wrappers so callers can use the original `app.importAttachments(...)` shape.
- `src/views/MarkdownView.ts`, `src/builtin/CanvasView.ts`, and `src/builtin/FileExplorerView.ts` now share the same attachment import path instead of independently parsing and saving dropped files.
- The reconstructed `App.importAttachments` accepts an optional explicit source file to keep Canvas/editor tests deterministic; when omitted it defaults to `workspace.getActiveFile()`, matching the original public API behavior.

## Bases file drops and attachment imports

Reverse source evidence:

- `@2377469`: Bases defines a shared post-drop helper for files that infers base frontmatter/folder, merges frontmatter into each file, moves files into the inferred folder when needed, and lets the query refresh include them.
- `@2377912`: Bases registers `app.dragManager.handleDrop(viewContainerEl, callback, true)` so the same callback handles internal `DragSource` and external `DataTransfer` file drops.
- `@2378403`: the external branch only handles `kP(event.dataTransfer)` file payloads; external text and URI-list drops are ignored by Bases.
- `@2378610`: external files call `app.importAttachments(CP(event.dataTransfer, "drop", true), folder)` before feeding the imported `TFile[]` into the same base post-drop helper.
- `@2202851`: the `FY(...)` inference helper derives frontmatter values and a target folder from the current base query/view configuration.
- Internal source handling accepts `file`, resolved `link`, `files` entries that are `TFile`, and file bookmarks, then applies the same post-drop helper.

Reconstruction notes:

- `src/bases/BasesView.ts` now registers the rendered `.bases-view-body` with `DragManager.handleDrop(..., true)`.
- External file drops use `getAttachmentFilesFromDataTransfer(...)` and the shared `app.importAttachments(...)` path; if the base inference produces an existing folder, that folder is passed as the target folder.
- Internal file/link/files/bookmarks drops collect `TFile` values and do not import new attachments.
- `applyFilesToBase(...)` merges inferred frontmatter into markdown files, moves files to the inferred folder when present, recomputes markdown metadata, and calls `refresh()` so the query result updates.
- Bases still intentionally ignores external `text/plain`, `text/uri-list`, and `text/html` drops, matching the original Bases drop branch.

## Attachment hover detection versus drop extraction

Reverse source evidence:

- `@1538364`: `kP(dataTransfer)` checks for file-like payloads by scanning `DataTransfer.items` for `kind === "file"`.
- `@1538450`: `kP` has an additional platform fallback that checks `DataTransfer.types` for `"Files"`.
- `@1538503`: `CP(dataTransfer, "drop" | "clipboard", includeData)` extracts attachment records and is the path that can obtain file objects and data.
- `@2378398` / `@2378628`: Bases uses `kP(...)` for hover acceptance and calls `CP(..., "drop", true)` only in the non-hover drop branch.
- `@3076718` / `@3076771`: Canvas follows the same split: hover checks `kP(...)`; drop calls `CP(...)` before `app.importAttachments(...)`.
- `@3240848` / `@3240895`: File explorer folder drops also use `kP(...)` for hover and defer `CP(...)` until drop.

Reconstruction notes:

- `src/app/AttachmentImport.ts` now separates `hasDataTransferAttachmentFiles(...)` from `getAttachmentFilesFromDataTransfer(...)`.
- `hasDataTransferAttachmentFiles(...)` is the light `kP` equivalent and includes the `DataTransfer.types` `"Files"` fallback.
- `getAttachmentFilesFromDataTransfer(...)` is the heavier `CP` equivalent and is only called by explicit drop/paste handlers when the drop actually executes.
- Canvas, File Explorer folder drops, and Bases now use `hasDataTransferAttachmentFiles(...)` during hover and defer attachment record creation/data reads until the non-hover drop branch.
- Tests assert that dragover does not call `File.arrayBuffer()` for Canvas, File Explorer, or Bases external file drops.

## Pasted image naming in shared attachment imports

Reverse source evidence:

- `@1567066` to `@1567171`: detached HTML data images are saved through the attachment path with base name `Pasted image`.
- `@1111` evidence note: this detached-image path only saves `image/png` and `image/jpeg` attachments.
- `@1113` evidence note: saved detached images use `Pasted image YYYYMMDDHHmmss` before insertion.
- `@1184` evidence note: `CP(..., "clipboard", true)` names pathless PNG/JPEG files `Pasted image`, so the shared save path must apply the same timestamp rule.

Reconstruction notes:

- `src/app/AttachmentImport.ts` now infers `png`/`jpg` from unnamed PNG/JPEG file MIME types.
- `src/app/AttachmentImport.ts` exports the timestamp formatter used for `Pasted image` attachment basenames.
- `src/vault/FileManager.ts` applies `Pasted image YYYYMMDDHHmmss` in the shared `saveAttachment` and target-folder attachment save paths.
- Markdown detached HTML image saving now reuses the shared timestamp formatter instead of keeping a private duplicate.

## DataTransfer file metadata without eager data reads

Reverse source evidence:

- `@1243`: `CP(..., false)` scans `DataTransfer.items` for file items and captures name/extension/path metadata only.
- `@1244`: Markdown URI handling checks only the first file item for `.webloc` or `.url`.
- `@1245`: when that first file item matches, Obsidian uses the filename without extension as the inserted URI title.

Reconstruction notes:

- `getAttachmentFilesFromDataTransfer(dataTransfer, includeData)` now mirrors this split: data is included by default for real imports, but callers can request metadata-only records.
- Markdown `.webloc/.url` URI title detection calls `getAttachmentFilesFromDataTransfer(..., false)` so it does not call `File.arrayBuffer()` while only inspecting the filename.

## Electron file path extraction for attachment records

Reverse source evidence:

- `@2288`: `CP(dataTransfer, "drop" | "clipboard", includeData)` produces attachment records containing `name`, `filepath`, `extension`, and `data`.
- `@1051`: Electron file path retrieval was previously listed as not yet reconstructed.

Reconstruction notes:

- `src/app/AttachmentImport.ts` now accepts an original-shaped `mode` argument in `getAttachmentFilesFromDataTransfer(dataTransfer, mode, includeData)` while preserving the earlier boolean `includeData` shorthand.
- `src/app/AttachmentImport.ts` attempts Electron `webUtils.getPathForFile(file)` before falling back to legacy `file.path` and `webkitRelativePath`.
- The Electron lookup is runtime-detected through `require("electron")`, so browser/Vite/jsdom usage keeps working without a static Electron dependency.
- Markdown HTML data-image detachment now saves through `App.saveAttachment(...)` / `FileManager.saveAttachment(...)` instead of writing directly through `Vault`, keeping clipboard/drop attachment naming and target-folder behavior centralized.

## Markdown drop-coordinate insertion

Reverse source evidence:

- `@1569325`: `AL.prototype.handleDrop` is the Markdown editor body drop handler.
- `@1569847`: before replacing the selection, the original calls CodeMirror `posAtCoords({ x: event.clientX, y: event.clientY })` and collapses the editor selection to that drop position.
- `@1569998`: external drop handling feeds markdown back into the same editor insertion flow.
- `@1051`: CodeMirror drop-coordinate insertion was previously listed as not yet reconstructed.

Reconstruction notes:

- `src/editor/Editor.ts` now exposes optional `posAtCoords(...)` so a CodeMirror-backed editor can provide exact coordinate mapping.
- `src/views/MarkdownView.ts` now calls `setDropInsertionPoint(event)` before internal and external markdown `replaceSelection(...)` paths, while leaving open-in-leaf drops untouched.
- The current textarea-backed source editor has a bounded fallback that maps client coordinates through textarea rect, scroll, padding, line height, and measured character width, then clamps the result to a valid editor position.
- Tests cover both exact `posAtCoords(...)` usage and the textarea fallback path.

## HTML drop sanitizer and Turndown parity refinements

Reverse source evidence:

- `@1566717`: the original sanitizer has a token-list helper that keeps only allowlisted iframe attribute tokens.
- `@3669000`: iframe `sandbox` is sanitized when present and defaults to `allow-forms allow-presentation allow-same-origin allow-scripts allow-modals` when missing; iframe `allow` is also token-filtered.
- `@3716066`: HTML resource-path fixing scans `img`, `audio`, `video`, `source`, and `iframe` elements, not only top-level media elements.
- `@1536570`: highlighted code language extraction uses `highlight-(?:text|source)-([a-z0-9]+)`.

Reconstruction notes:

- `src/markdown/HtmlDropPreprocessor.ts` now sanitizes iframe `sandbox` and `allow` token lists and applies the original default sandbox when absent.
- `src/markdown/HtmlDropPreprocessor.ts` now applies resource-path rewriting to `source` and `iframe` elements in addition to `img`, `audio`, and `video`.
- Long `data:` detachment is now limited to supported PNG/JPEG image nodes; unsupported long data media is preserved instead of being deleted.
- `src/markdown/HtmlToMarkdown.ts` now narrows highlighted-code language matching to the original lowercase alphanumeric rule.

## HTML-to-Markdown Turndown rule parity refinements

Reverse source evidence:

- `@1531835`: the original `highlightedCodeBlock` rule only applies when the current node is a `DIV`, its class matches `highlight-(?:text|source)-...`, and its first child is the `PRE` node used for the replacement.
- `@1535141`: the original table rule uses the current table's `rows[0]` rather than a broad descendant `querySelectorAll("tr")` scan.
- `@1534884`: the original table row rule uses `row.cells`, so only real table cells participate in column counting and row rendering.
- The original custom Turndown rule block does not override blockquote; blockquote remains closer to Turndown default behavior.
- `@1535427`: `hP.escape = identity`, so plain Markdown-significant text is not escaped by the Turndown service.

Reconstruction notes:

- `src/markdown/HtmlToMarkdown.ts` now only applies highlighted-code language extraction when the `pre` is the first child of a `div.highlight-*` container.
- Table conversion now uses the current `HTMLTableElement.rows` filtered to the current table and `HTMLTableRowElement.cells`, avoiding parent tables accidentally rendering nested table rows as additional parent rows.
- Blockquote conversion now uses a Turndown-style prefix replacement and avoids the previous per-line trim behavior.
- Tests lock the identity-escape behavior for plain Markdown syntax so future changes do not accidentally add generic Markdown escaping.

## Command manager editor command gating parity

Reverse source evidence:

- `@2897088`: original `addCommand` skips `mobileOnly` commands using the centralized platform flag (`Yl.isMobile`).
- `@2897247` to `@2897430`: original editor command wrapper applies inline title, title, and metadata focus suppression only when the active editor view is MarkdownView.
- `@2897430`: metadata suppression checks the active element with `.closest(".metadata-container")`, not only a stored view property.
- `@1497` / `@1641`: menu checked state uses `mod-checked`, not `is-checked`.

Reconstruction notes:

- `src/commands/CommandManager.ts` now uses the shared `Platform.isMobile` flag for `mobileOnly` command registration.
- Markdown-specific editor command suppression is now scoped to `getViewType() === "markdown"`, so custom editor-like views with title fields are not accidentally suppressed.
- Metadata focus suppression keeps the explicit `metadataContainerEl` check and adds the original-style active-element `.closest(".metadata-container")` fallback.
- `src/commands/CommandManager.test.ts` now verifies custom-view title focus is not suppressed, Markdown metadata fallback suppression, centralized mobile-only gating, and the original `mod-checked` menu class.

## Command palette search, pinned search, and localStorage parity

Reverse source evidence:

- `@3194103`: command palette command ordering sorts by command name and recent ids; no palette-specific fuzzy score length bonus is applied.
- `@1071776`: shared fuzzy sorting orders directly by `match.score` descending.
- `@3720021`: `App.saveLocalStorage(key, value)` removes the app-scoped key when the value is falsy, rather than writing JSON `null`.
- `@3196138`: command palette pinned settings use the shared command selector/fuzzy chain instead of a simple substring includes search.

Reconstruction notes:

- `src/commands/CommandPalette.ts` now relies on the inherited `FuzzySuggestModal` sorting without adding a palette-specific command-name-length score bonus.
- `src/commands/CommandPalette.ts` now uses `prepareFuzzyQuery`, `fuzzyMatch`, and `sortFuzzySuggestions` for pinned command settings search, so non-contiguous abbreviations can find commands.
- `src/app/App.ts` now removes app-scoped localStorage keys when saving `null` or `undefined`, matching the original falsy-delete storage contract.
- Tests cover recent-command storage deletion and fuzzy pinned-settings search.

## Quick Switcher q2 matching and attachment filter parity

Reverse source evidence:

- `@2810997`: Quick Switcher file matching/display helper `q2(file)` removes `.md` from markdown file paths before matching/rendering.
- `@2812970`: non-empty Quick Switcher suggestions fuzzy-match file candidates through the q2 text path.
- `@2669982`: recent files use the recent-file tracker options directly; image and non-image attachment recent visibility follows `showAttachments`, not `showAllFileTypes`.
- Quick Switcher file filtering keeps markdown/canvas/base visible by default, includes registered attachment types when attachment visibility is enabled, and reserves unrestricted extension visibility for `showAllFileTypes`.

Reconstruction notes:

- `src/builtin/QuickSwitcher.ts` now returns the q2-equivalent title from `getItemText(...)`, so markdown files are matched by paths without `.md`.
- Empty-query recent suggestions no longer widen attachment visibility merely because `showAllFileTypes` is enabled; recent attachment visibility follows `showAttachments`.
- Non-all-file attachment visibility now checks registered file extensions or known media/document attachment extensions, while `showAllFileTypes` still includes everything.
- Tests cover q2-style markdown matching, recent attachment filtering, and registered/all-file attachment visibility.

## Quick Switcher create row and openLinkText parity

Reverse source evidence:

- `@2812970`: the original Quick Switcher no-match branch returns a `null` suggestion row instead of manufacturing a dedicated create item in the suggestion list.
- `@2815209`: rendering a `null` suggestion draws the create-new-note row from the current input value.
- `@2814243` to `@2814362`: choosing the create row calls workspace-level `openLinkText(inputValue, sourcePath, paneType, { active: true })`, letting the workspace/file-manager path resolver own missing-note creation.
- `showExistingOnly` suppresses unresolved link suggestions, but it does not suppress the no-match create row.

Reconstruction notes:

- `src/builtin/QuickSwitcher.ts` now models suggestion items as `QuickSwitcherItem | null`, with `null` reserved for the create row.
- Shift Enter and Mod Shift Enter synthesize the same `null` suggestion path as the no-match branch, instead of passing an impossible selected item.
- Missing-note creation now delegates to `workspace.openLinkText(...)`, so path normalization, folder selection, source mode, and split/new-tab handling stay centralized in the workspace layer.
- Tests cover null create suggestions, existing-only create behavior, Shift Enter creation through `openLinkText`, and the create-row rendering contract.

## Linktext and subpath parsing helper

Reverse source evidence:

- `@1331939`: internal link conversion extracts a link subpath from linktext before generating Markdown links.
- `@1332667`: heading subpaths preserve nested heading structure by joining sanitized parent/child headings with additional `#` separators.
- `@2814243` to `@2814362`: Quick Switcher creation/opening delegates to workspace-level `openLinkText(...)`, so the open-link parser is shared by command, switcher, and protocol-style entry points.

Reconstruction notes:

- `src/metadata/Linkpath.ts` now owns the shared split/parse helpers.
- `splitLinkpath(...)` preserves the full subpath suffix, so `Target#Heading#Child` becomes `path="Target"` and `subpath="#Heading#Child"`.
- `parseLinktext(...)` removes display aliases and converts the leading `#` form into open-file ephemeral state, so `Target#Heading#Child|Alias` yields `subpath="Heading#Child"`.
- `WorkspaceLeaf.openLinkText`, `obsidian://open`, and `LinkSuggestionManager` now share the same parser instead of keeping separate split implementations.
- `WorkspaceLeaf.openLinkText` keeps missing-link parent resolution synchronous before `createNewFile(...)`, preserving the quick-switcher create path's original same-turn file creation behavior.

## Rendered markdown link context menus

Reverse evidence from the original bundle shows preview/rendered links do not use the reconstructed `link-menu` path:

- Rendered internal links call `onInternalLinkRightClick`, add a `Copy` item for the visible rendered text, then delegate to `workspace.handleLinkContextMenu(menu, linktext, sourcePath)`. Resolved targets therefore reach `file-menu` with source `link-context-menu`; unresolved targets get the default create-file action.
- Rendered external links call `onExternalLinkRightClick`, add a `Copy` item for the visible rendered text, then delegate to `workspace.handleExternalLinkContextMenu(menu, url)`, which emits `url-menu`.
- Rendered embeds use `.internal-embed` and their own embed/open affordance. They are not treated as normal `.internal-link` context targets in preview.

The reconstruction mirrors this in `MarkdownRenderer`: preview link context menus prevent the generic markdown viewport menu from opening first, then route internal links through `handleLinkContextMenu` and external links through `handleExternalLinkContextMenu`.

## Public plugin module utility exports

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` publicly exports utility constants/functions including `apiVersion`, `requireApiVersion`, binary helpers (`arrayBufferToBase64`, `base64ToArrayBuffer`, `arrayBufferToHex`, `hexToArrayBuffer`, `getBlobArrayBuffer`), link helpers (`parseLinktext`, `getLinkpath`), frontmatter helpers (`parseFrontMatterEntry`, `parseFrontMatterStringArray`, `parseFrontMatterAliases`, `parseFrontMatterTags`, `getFrontMatterInfo`), `getAllTags`, `htmlToMarkdown`, and `sanitizeHTMLToDom`.
- The original bundle export table maps `apiVersion` to `gte`; direct bundle search shows `gte="1.12.7"` and `requireApiVersion` as `function bte(e){return !gy(gte,e)}`, i.e. current API version is greater than or equal to the requested version.
- The reconstruction now exposes these low-risk public utility exports from `src/api/ApiUtils.ts`, re-exports them from `src/index.ts`, and includes them in `createObsidianPluginModule(...)` so runtime plugin modules receive the same facade surface.
- `moment`, MathJax/Mermaid/Prism loaders, fuzzy search render helpers, and full subpath resolution remain separate slices because they require either external runtime services or deeper cache/search semantics.

## Public plugin module workspace constructors

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` publicly declares `Workspace` as an exported runtime class, and the original bundle export table maps `Workspace` to `H0`.
- The original bundle export table also exposes `ViewRegistry` (`ViewRegistry:()=>p0`). The local reconstruction already has `src/workspace/Workspace.ts` and `src/workspace/ViewRegistry.ts`, and both are exported from `src/index.ts`.
- The plugin runtime facade now includes `Workspace` and `ViewRegistry` so plugins loaded through `createObsidianPluginModule(...)` receive those constructors at runtime, matching the bundle export surface more closely.

## Public plugin module workspace, preview, and hover constructors

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- The original public declaration includes the workspace class family around the workspace section: `WorkspaceContainer`, `WorkspaceItem`, `WorkspaceParent`, `WorkspaceSplit`, `WorkspaceTabs`, `WorkspaceWindow`, plus sidedock/ribbon/root/floating classes. The bundle export table exposes the same runtime constructors around offsets `254779` to `255007`.
- The original public declaration includes `MarkdownPreviewRenderer`, `MarkdownPreviewSection`, and `MarkdownPreviewView`; the bundle export table exposes the preview constructors around offsets `253754` to `253838`.
- The original public declaration includes `HoverPopover`; the bundle export table exposes it around offset `253604`.
- The reconstruction already has local implementations for these constructors, so `createObsidianPluginModule(...)` now exposes them directly. This improves plugin runtime import parity without inventing new behavior.
- Scope boundary: this is runtime facade parity only. Behavioral fidelity for each class remains governed by its own workspace/markdown/hover tests and reverse-evidence slices.

## App public render/theme/secret API

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `App.renderContext: RenderContext`, `App.secretStorage: SecretStorage`, and `App.isDarkMode(): boolean` on the public app object.
- `obsidian.d.ts` declares `SecretStorage extends Events` with synchronous `setSecret(id, secret)`, `getSecret(id)`, and `listSecrets()` methods. Secret IDs are documented as lowercase alphanumeric IDs with optional dashes.
- The reconstruction now attaches a root `RenderContext` to `App`, exposes a `SecretStorage` instance for plugin credential-style values, exports the `SecretStorage` constructor through both `src/index.ts` and the plugin module facade, and implements `App.isDarkMode()` from the same body theme class toggled by `AppearanceManager`.

## Command synchronous check callbacks

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `Command.checkCallback?: (checking: boolean) => boolean | void` and `Command.editorCheckCallback?: (checking, editor, ctx) => boolean | void`.
- The official comments say returning `false` or `undefined` hides a command from the command palette; only `true` means the command can be shown.
- The public declaration keeps command availability checks synchronous, but the observed runtime uses normal JavaScript truthiness. Promise-like check results are not specially rejected and therefore appear available.

## Plugin settings field

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `Plugin.settings?: unknown` as part of the public plugin base class.
- The reconstruction now exposes the same mutable field so common plugin patterns like `this.settings = await this.loadData()` type-check against the local API surface.

## Public icon registry API

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` publicly exports `addIcon(iconId, svgContent)`, `getIcon(iconId)`, `getIconIds()`, `removeIcon(iconId)`, and `setIcon(parent, iconId)`.
- The original bundle export table exposes the same icon helpers, including `addIcon`, `getIcon`, `getIconIds`, `removeIcon`, and `setIcon`.
- The reconstruction now models the icon library as a mutable registry seeded by the built-in icon paths. `addIcon` registers plugin-provided SVG body content, `getIcon` returns a fresh `SVGSVGElement` or `null`, `getIconIds` returns registered IDs, `removeIcon` unregisters an ID, and `setIcon` renders from the shared registry. Unknown icon IDs do not insert a fallback icon.

## Public subpath resolution helpers

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` declares `resolveSubpath(cache, subpath): HeadingSubpathResult | BlockSubpathResult | FootnoteSubpathResult | null`, plus `stripHeading(heading)` and `stripHeadingForLink(heading)`.
- The bundle export table maps `resolveSubpath` to `FT`, `stripHeading` to `LT`, and `stripHeadingForLink` to `IT`.
- `LT` uses `/[!"#$%&()*+,.:;<=>?@^`{|}~\/\[\]\\\r\n]/g`, replaces matches with spaces, collapses whitespace, and trims.
- `IT` uses `/([:#|^\\\r\n]|%%|\[\[|\]\])/g`, replaces matches with spaces, collapses whitespace, and trims.
- `FT(cache, subpath)` splits by `#` and filters empty parts. A single `^id` part resolves a block case-insensitively through `cache.blocks`; a single `[^id]` part resolves a footnote case-sensitively through `cache.footnotes`; other paths resolve heading chains using `stripHeading(...).toLowerCase()`. Nested headings require the next part to be a deeper level than the previous match, and heading result `end` is the next heading whose level is less than or equal to the matched heading's level, or `null`.
- The reconstruction now exposes `stripHeading`, `stripHeadingForLink`, and `resolveSubpath` from `ApiUtils` and the plugin module facade. `MetadataCache` now stores heading start/end ranges plus `blocks`/`listItems` derived from the existing `BlockCache` parser so `#^blockid`, `#[^footnote]`, and `#Parent#Child` can all resolve from a normal file cache.

## CachedMetadata frontmatter and section ranges

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `Loc { line, col, offset }`, `Pos { start, end }`, `CacheItem.position: Pos`, `SectionCache extends CacheItem { id?, type }`, and `CachedMetadata.frontmatterPosition?: Pos`.
- `CachedMetadata.sections` are documented as root-level markdown blocks. The official section type union includes `yaml`, `heading`, `callout`, `list`, `paragraph`, `thematicBreak`, `code`, `table`, `html`, and other parser-generated strings.
- The reconstruction now emits `frontmatterPosition` for recognized frontmatter blocks even when the YAML subset is invalid, adds a `yaml` section for that range, and populates root-level `sections` for common markdown block types using the same `{ line, col, offset }` position shape as the public API.
- The reconstruction now exports the official cache item type names (`Loc`, `Pos`, `CacheItem`, `FrontMatterCache`, `HeadingCache`, `SectionCache`, `BlockCache`, `ListItemCache`, `ReferenceLinkCache`, `FootnoteCache`, `FootnoteRefCache`, and `TagCache`) from `MetadataCache`, and block-derived positions now use the same 0-based line/column convention as the rest of `CachedMetadata`.
- The internal markdown block parser cache class is named `MarkdownBlockCache` so the public `BlockCache` name matches Obsidian's `CachedMetadata.blocks` data interface instead of an implementation class.
- `ListItemCache.parent` is now populated from list indentation: root list items receive the negative start line for their list group, while nested items point at the parent list item's start line, matching the official hierarchy contract.
- `obsidian.d.ts` declares `Reference { link, original, displayText? }`, `ReferenceCache extends Reference, CacheItem`, `LinkCache`, `EmbedCache`, `ReferenceLinkCache { id, link, position }`, `FrontmatterLinkCache extends Reference { key }`, and `TagCache extends CacheItem { tag }`.
- The reconstruction now emits official `Pos` positions for links, embeds, reference links, and tags; preserves wiki subpaths and display text in the cache layer; emits frontmatter link records with `key/link/original/displayText`; and keeps an internal `source` helper for backlinks/outgoing-link highlighting without replacing the public `position` shape.

## Public requestUrl/request API

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` declares `request(request: RequestUrlParam | string): Promise<string>` and `requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise`.
- `RequestUrlParam` includes `url`, `method`, `contentType`, `body`, `headers`, and `throw?: boolean`; `throw` controls whether HTTP status codes `>= 400` reject and defaults to true.
- `RequestUrlResponsePromise` is both a promise for the full response and has child promises `.text`, `.json`, and `.arrayBuffer`.
- The reconstruction now models `requestUrl` as one shared fetch/body-read promise plus child promises for the three response forms. `request(...)` returns `requestUrl(...).text`. HTTP errors reject by default with `status` and `response` attached, while `{ throw: false }` resolves the response object.
- `requestUrl`, `request`, `RequestUrlParam`, `RequestUrlResponse`, `RequestUrlResponsePromise`, `normalizePath`, `debounce`, `Debouncer`, and `DebouncedFunction` now live in the top-level `ApiUtils` public module, so `src/index.ts` and the CommonJS plugin facade share one implementation instead of maintaining separate API surfaces.

## Bases public option/config types

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares the public Bases view configuration type `BasesConfigFileView` with `type`, `name`, optional `filters`, `groupBy`, `order`, and `summaries`.
- `obsidian.d.ts` declares the view-option model as `BasesAllOptions = BasesOptions | BasesOptionGroup<BasesOptions>`, with `BasesOption`, `BasesOptionGroup`, dropdown/file/folder/formula/multitext/property/slider/text/toggle option variants.
- `obsidian.d.ts` declares `BasesProperty { type, name }`, `BasesPropertyId`, `BasesPropertyType`, `BasesSortConfig`, and an empty `FormulaContext`; `BasesEntry` implements `FormulaContext`.
- The reconstruction now exposes those public type names from the existing `src/bases` modules without changing the current runtime view/config machinery.
- The official `BasesConfigFileView` type is exposed as a public serialized view shape, while the internal `BasesViewDefinition` remains the runtime view definition because it carries additional reconstructed fields such as `id`, `columns`, and array-style filter data.

## Markdown view public mode/event types

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `MarkdownViewModeType = 'source' | 'preview'`, `MarkdownSubView` with `getScroll`, `applyScroll`, `get`, and `set`, and `MarkdownPreviewEvents extends Component`.
- `obsidian.d.ts` declares `MarkdownEditView implements MarkdownSubView` and `MarkdownRenderer implements MarkdownPreviewEvents`.
- The reconstruction now exposes the official `MarkdownViewModeType`, `MarkdownSubView`, and `MarkdownPreviewEvents` names while keeping the richer internal `MarkdownViewModeComponent` for fold, ephemeral state, show/hide, and lifecycle behavior.

## Command and core event overload API

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `Command.icon?: IconName`, `editorCallback(editor, ctx: MarkdownView | MarkdownFileInfo)`, and `editorCheckCallback(checking, editor, ctx: MarkdownView | MarkdownFileInfo)`.
- `obsidian.d.ts` declares `MetadataCache.on('changed'|'deleted'|'resolve'|'resolved', ...)` with concrete callback argument shapes.
- `obsidian.d.ts` declares `Vault.on('create'|'modify'|'delete'|'rename', ...)` with concrete file event callback argument shapes.
- The reconstruction now exposes those official type overloads while retaining the generic `Events.on(...)` fallback for internal events such as cache lifecycle and raw adapter notifications.

## PluginManifest official shape and input normalization

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `PluginManifest` with required `id`, `name`, `author`, `version`, `minAppVersion`, and `description`, optional `dir`, `authorUrl`, and `isDesktopOnly`, and no `styles` field.
- Real manifest sources can still be partial while they are being discovered, downloaded, or registered from marketplace data, so the reconstruction splits `PluginManifestInput` from the public `PluginManifest`.
- `normalizePluginManifest(...)` supplies official runtime defaults (`author=""`, `minAppVersion="0.0.0"`, `description=""`) and keeps `styles` only on `RuntimePluginManifest`, preserving compatibility with existing package loading without leaking `styles` into the public manifest interface.

## Menu parent element attachment

Evidence source: reconstructed Markdown property row behavior and `Menu.setParentElement(...)` usage.

- Metadata property rows call `menu.setParentElement(rowEl).showAtMouseEvent(event)` for the property-type menu, and tests/DOM consumers inspect the row as the active menu parent.
- `Menu.showAtPosition()` appends both the menu DOM and background overlay to `body`; `parentEl` is only marked with `.has-active-menu`, matching the original menu anchoring contract.
- Menu keyboard/hover selection keeps scroll-into-view behavior when available but treats `scrollIntoView` as optional, matching non-browser/jsdom environments where menu selection should still open submenus.

## Public search helper API

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` declares `prepareFuzzySearch(query)`, `prepareSimpleSearch(query)`, `renderMatches(el, text, matches, offset?)`, `renderResults(el, text, result, offset?)`, and `sortSearchResults(results)`.
- The bundle export table maps these helpers to `Sy`, `Oy`, `Ny`, `Fy`, and `Ay` respectively.
- `Sy` prepares a query by tokenizing whitespace, punctuation, and CJK ranges, then matches either token sequence or fuzzy character sequence. Scores penalize split matches, skipped word-starts, span width, start offset, and target length.
- `Oy` lowercases space-separated query words, requires every non-empty word to appear, merges overlapping ranges, and uses the same score formula.
- `Ay` sorts containers by descending `match.score`.
- `Ny` appends text plus `span.suggestion-highlight` ranges to the target element/fragment. `Fy` renders `result.matches` through `Ny`.
- The reconstruction now exposes these helpers from `src/search/SearchHelpers.ts`, `src/index.ts`, and the plugin module facade. The internal full-text search result type was renamed to `VaultSearchResult` so the public `SearchResult { score, matches }` name matches Obsidian's API surface.

## Vault/DataAdapter public file API

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `DataAdapter` as the lower-level vault IO surface with `getName`, `stat`, `read/readBinary`, `write/writeBinary`, `append/appendBinary`, `process`, `getResourcePath`, trash/delete/rename helpers, and `copy`.
- `DataWriteOptions` carries optional `ctime` and `mtime`; `Stat` includes `type`, `ctime`, `mtime`, and `size`.
- `TFile` exposes a public `stat: FileStats` alongside `basename` and `extension`.
- `Vault` exposes `cachedRead`, `modifyBinary`, `append`, `appendBinary`, `process(..., options)`, generic `copy<T extends TAbstractFile>`, and static `recurseChildren`.
- The reconstruction now keeps `TFile.stat` current for in-memory text/binary writes, reads adapter stats when available, exposes the DataAdapter append/process/copy surface, and implements recursive Vault folder copy without involving workspace or DOM rendering.
- `obsidian.d.ts` differentiates direct `Vault.read(file)` from display-oriented `Vault.cachedRead(file)`. The reconstruction now keeps a plaintext `cachedRead` cache keyed by file path, while local writes, adapter modify events, rename, delete, and trash paths invalidate the affected cache entries so plugin display reads can reuse text without serving stale content after file changes.
- `obsidian.d.ts` describes both `DataAdapter.process(normalizedPath, fn, options)` and `Vault.process(file, fn, options)` as atomically reading, modifying, and saving plaintext, returning the string that was written. The reconstruction now serializes concurrent `process` calls per adapter path and per vault file path so multiple plugin-side updates cannot observe the same stale text and overwrite one another.
- `Vault.rename(file, newPath)` now follows the official `Promise<void>` public return shape. The renamed `TAbstractFile` object is still mutated in place, and higher-level helpers that need to continue with the file return that same object after awaiting the rename.

## FileManager public helper API

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `FileManager.renameFile(file: TAbstractFile, newPath): Promise<void>` as the safe rename layer above raw `Vault.rename`, preserving the link-update behavior.
- `promptForDeletion(file)` is public and returns the confirmation result without itself removing the file; `trashFile(file)` performs deletion according to the vault trash preference.
- `processFrontMatter(file, fn, options?)` mutates parsed frontmatter and forwards `DataWriteOptions` to the vault write path.
- `obsidian.d.ts` declares the frontmatter callback as synchronous `(frontmatter) => void`, matching `Vault.process(file, fn)`'s synchronous transform contract.
- `getAvailablePathForAttachment(filename, sourcePath?)` is the single-filename public helper; internally it resolves the configured attachment folder, creates it if needed, and dedupes the final path.
- The reconstruction now exposes those public entry points while reusing the existing link-update modal, delete-confirmation modal, frontmatter serializer, and Vault attachment path resolver.

## MarkdownRenderer public class shape

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `MarkdownRenderer` as an abstract `MarkdownRenderChild` subclass with deprecated `renderMarkdown(markdown, el, sourcePath, component)` and current `render(app, markdown, el, sourcePath, component)`.
- The reconstruction already routed markdown rendering through the app-aware static `render` method; the class shape now extends `MarkdownRenderChild` while preserving the existing parser, code-block processor, postprocessor, internal-link, and child-cleanup pipeline.
- `MarkdownPostProcessor` is modeled as a callable interface with optional `sortOrder`; registration uses an explicit sort order when supplied and otherwise reads `processor.sortOrder ?? 0`.

## Workspace quick-preview event

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` declares the Workspace `quick-preview` event as `(file: TFile, data: string)`, described as the active Markdown file being modified before save.
- The original bundle routes live Markdown data through `workspace.onQuickPreview(file, data)`, which then triggers `quick-preview`.
- The reconstruction now exposes `Workspace.onQuickPreview(file, data)` as the app-level event bridge.
- `MarkdownView` now funnels editor content changes through a single helper that preserves `editor-change` and also emits `quick-preview` with the current unsaved `getViewData()` text, so built-ins like Word Count and plugins can react before disk persistence.

## Workspace recent file API parity

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `Workspace.getLastOpenFiles(): string[]` and describes it as the filenames of the 10 most recently opened files.
- The reconstruction now keeps `RecentFileTracker` storage as path strings, exposes public `getLastOpenFiles()` as `string[]`, and retains `getRecentFiles(options)` for internal object-based consumers such as Quick Switcher.
- A private tracker split avoids leaking `TFile[]` through the official API while still filtering out deleted paths and respecting the existing recent-file visibility options.

## Workspace active file and leaf events

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` documents `Workspace.getActiveFile()` as returning the current `FileView` file, otherwise the most recently active file.
- `obsidian.d.ts` declares leaf-local `WorkspaceLeaf.on("pinned-change", (pinned: boolean) => ...)` and `WorkspaceLeaf.on("group-change", (group: string) => ...)` overloads.
- The reconstruction now preserves the existing workspace-level leaf events while also emitting the official leaf-local events with public payloads, and `getActiveFile()` falls back to the cached last active file when a command runs from a non-file view.
- `Workspace.getGroupLeaves(group)` now accepts the official group string rather than a leaf object; call sites derive the group id from `leaf.group` before querying.
- Debounced workspace requests now use the shared public `Debouncer` type shape while keeping `cancel()` chainable and `run()` immediate; `requestSaveLayout` is exposed as the official `Debouncer<[], Promise<void>>` instead of leaking `saveLayout()`'s internal layout return value.
- `Workspace.getLeftLeaf(split?)` and `Workspace.getRightLeaf(split?)` now expose the official nullable public return type, even though the current desktop/mobile reconstruction normally creates and returns a leaf.

## Workspace leaf creation and duplication API

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `PaneType = "tab" | "split" | "window"` and `Workspace.createLeafInParent(parent: WorkspaceSplit, index: number): WorkspaceLeaf`.
- `obsidian.d.ts` declares `Workspace.duplicateLeaf(leaf, direction?)` and `Workspace.duplicateLeaf(leaf, leafType: PaneType | boolean, direction?)`.
- The reconstruction now exposes `createLeafInParent` as a public split insertion API using the existing WorkspaceSplit/WorkspaceTabs tree, and implements `duplicateLeaf` by creating the requested target leaf and copying the source view state, ephemeral state, and independent history snapshot into it.

## Workspace file and files menu events

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `file-menu` as `(menu, file: TAbstractFile, source, leaf?)`, not only `TFile`.
- `obsidian.d.ts` declares `files-menu` as `(menu, files: TAbstractFile[], source, leaf?)` for multi-selection contexts in the File Explorer.
- The reconstruction now lets `MenuManager.createFileMenu` accept any `TAbstractFile`, emitting defaults only for openable `TFile`s while still firing `file-menu` for folders.
- `FileExplorerView` folder context menus now emit `file-menu`, so plugins can contribute folder actions without replacing the built-in folder menu.
- `MenuManager.createFilesMenu` provides the reconstructed multi-file event bridge, preserving source and leaf metadata for future File Explorer multi-selection wiring.
- `FileExplorerView` now keeps a lightweight multi-selection set. Meta/Ctrl/Shift-click toggles selected files/folders, and right-clicking a selected group emits `files-menu` from the real file explorer context path instead of only through a test helper.

## Workspace link context menu return contract

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `Workspace.handleLinkContextMenu(menu, linktext, sourcePath, leaf?): boolean`.
- The reconstruction now returns `false` for empty link text and `true` when it contributes either resolved-file menu actions or unresolved create-file actions.
- Resolved links forward the explicit source leaf to the `file-menu` event when provided, preserving the public event payload shape used by plugins.

## PluginSettingTab declarative settings API

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares the 1.13 `SettingTab` declarative settings surface: `settingItems`, `getSettingDefinitions()`, `update()`, `getControlValue(key)`, `setControlValue(key, value)`, and `refreshDomState()`.
- `obsidian.d.ts` declares `PluginSettingTab` as the plugin-specific subclass that keeps the same declarative surface but defaults control value storage to `this.plugin.settings` and persists mutations through plugin data.
- `SettingDefinitionItem` is a union of direct setting definitions, groups, lists, and pages; control definitions cover toggle, dropdown, text, textarea, number, file, folder, slider, and color controls through a shared `SettingControlBase` with `key`, `defaultValue`, `validate`, and `disabled`.
- The reconstruction now renders non-empty `getSettingDefinitions()` before falling back to imperative `display()`, caches definitions through `update()`, re-evaluates `visible` and `disabled` through `refreshDomState()`, validates declarative control changes before persistence, and exposes `DisplayValueComponent`/`addDisplayValue` for page display values.
- The reconstruction now wires `file` and `folder` controls to vault path input suggesters. `file` controls preserve the official full file path value including extensions, while `folder` controls pass through `filter` and `includeRoot` to the folder suggester.
- Declarative lists now render as `setting-list` groups with add-item header controls, per-row drag affordances for `onReorder(oldIndex, newIndex)`, delete controls, and Delete/Backspace keyboard deletion. Declarative pages surface `displayValue` and `status` on the row and re-evaluate them through `refreshDomState()` before opening nested declarative items.
- `Setting.setErrorMessage(message)` now follows the official lazy `errorEl` contract: `errorEl` starts as `null`, is created on the first non-empty message, and clears validation state for `null` or an empty string. Declarative group/list search also preserves the current query across re-renders and reapplies the group's `match(def, query)` filter after `update()`.
- `SettingsRenderer` now adds a settings search entry in the vertical tab header. The query filters tabs by id/name and by declarative setting text (`name`, string/fragment `desc`, aliases, page display values including function values), respects `visible:false` and `searchable:false` during indexing, then forwards the query to the active `SettingTab` so rendered declarative rows hide non-matching searchable definitions.

## Notice and Modal public API parity

Evidence sources: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` declares `Notice` with public `noticeEl`, `containerEl`, `messageEl`, `constructor(message: string | DocumentFragment, duration?)`, `setMessage(message: string | DocumentFragment)`, and `hide()`. The original bundle creates `.notice-container > .notice > .notice-message`, keeps duration `0` notices visible, and manually dismisses notices on click.
- The reconstruction now lets `Notice.setMessage` replace existing message content with either text or a `DocumentFragment`, matching the constructor's accepted message shape while preserving the existing notice container ownership and auto-hide behavior.
- `obsidian.d.ts` declares `Modal` with public `app`, `scope`, `containerEl`, `modalEl`, `titleEl`, `contentEl`, `shouldRestoreSelection`, `open`, `close`, `onOpen(): Promise<void> | void`, `onClose`, `setTitle`, `setContent(string | DocumentFragment)`, and `setCloseCallback(callback: () => any)`.
- The original bundle uses string replacement for `setContent`, appends non-string content, and stores the close callback for `close()`. The reconstruction now exposes mutable public Modal fields, accepts async `onOpen` overrides at the type level, preserves the callback return type, and adds a HistoryHandler-compatible `onHistoryBack()` close path.

## Menu public API and delayed context-menu bridge

Evidence sources: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` declares `Menu extends Component implements HistoryHandler`, `close(): void`, `onHide(callback): void`, and `static forEvent(evt: PointerEvent | MouseEvent): Menu`.
- The original bundle guards `addItem` and `addSeparator` with the Component loaded state, calls `load()` when a DOM menu is shown, calls `unload()` from `hide()`, and implements `close()` as a void wrapper around `hide()`.
- The original `Menu.forEvent(evt)` prevents default, memoizes one menu per event in a WeakMap, and schedules `showAtMouseEvent(evt)` with `setTimeout`, allowing event listeners to call `Menu.forEvent(evt).addItem(...)` before the menu opens.
- `MenuItem.setChecked(checked)` stores `true`, `false`, or `null`; truthy values render the check icon and `mod-checked` class, while `null` is preserved for native-menu tri-state compatibility without displaying a checkbox.
- The reconstruction now follows those lifecycle and callback contracts while preserving the existing DOM menu grouping, section sorting, submenu, keyboard navigation, and fallback DOM rendering behavior.

## Plugin public class shape and lifecycle hooks

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `Plugin` as an abstract `Component` subclass with mutable public `app` and `manifest` fields, optional public `settings`, and `onload(): Promise<void> | void`.
- `obsidian.d.ts` keeps `loadData(): Promise<any>` and `saveData(data: any): Promise<void>` broad rather than generic/nullable, while the runtime may still return `null` when no `data.json` exists.
- `obsidian.d.ts` declares `onExternalSettingsChange?(): any`, so plugins can return arbitrary values even though Obsidian ignores them for lifecycle purposes.
- `obsidian.d.ts` declares `addSettingTab(settingTab: PluginSettingTab): void`; the reconstruction now exposes the same plugin-specific public signature while still routing through the shared settings registry internally.
- The reconstruction already matched the major registration helpers (`addCommand`, `addRibbonIcon`, `addStatusBarItem`, `registerView`, `registerExtensions`, Markdown post/code-block processors, editor extensions, Obsidian protocol handlers, editor suggesters, CLI handlers, data load/save). This pass tightens the base class shape without changing those registration pipelines.
- The original bundle's `registerBasesView(viewId, registration)` only succeeds when the Bases core plugin is enabled. The reconstruction now returns `false` without registering anything when that optional extension host is unavailable, and otherwise registers through `app.bases` with unload cleanup.

## View base class and TextFileView public surface

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `View` as a `Component` subclass with mutable public `app`, `leaf`, `containerEl`, `scope: Scope | null`, `icon`, and `navigation` fields. It also exposes `onResize(): void` as the size-change hook used by view implementations.
- The reconstruction now preserves the existing Workspace state serialization while exposing `scope` as nullable and adding the no-op `onResize()` base hook, so custom views can opt out of view-local hotkeys without replacing the DynamicScope bridge.
- `obsidian.d.ts` declares `TextFileView.data` as the in-memory text and `requestSave: () => void` as the debounced save entry point. The reconstruction now maps `data` to the existing source buffer and exposes `requestSave` publicly while retaining the existing dirty flag and delayed save pipeline.

## WorkspaceLeaf public API parity

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `WorkspaceItem.getContainer(): WorkspaceContainer`, not a generic workspace item. The reconstruction already returned a root/window container at runtime; the public type now reflects that contract.
- `obsidian.d.ts` declares `WorkspaceLeaf.hoverPopover`, `isDeferred`, `loadIfDeferred()`, `open(view)`, `getViewState()`, `setViewState()`, `getEphemeralState()`, `setEphemeralState()`, `togglePinned()`, `setPinned()`, `setGroupMember()`, `setGroup()`, `detach()`, `getIcon()`, `getDisplayText()`, and `onResize()`.
- The reconstruction now exposes `hoverPopover` as a nullable field, maps `isDeferred` to both stored deferred view state and active `DeferredView`, and forwards `WorkspaceLeaf.onResize()` to the current view. Pin/group mutators now match the official void-returning public shape while preserving the existing event emission and layout-save side effects.

## Workspace readiness and view-hosting API

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `Workspace.layoutReady` as a public boolean and `Workspace.onLayoutReady(callback: () => any): void`. Plugins use this gate to defer view-opening work until the layout tree is restored.
- The reconstruction already queued `onLayoutReady` callbacks and flushed them from `markLayoutReady()`. This pass exposes the same readiness state as the public `layoutReady` accessor while keeping the existing internal callback and active-file event flow intact.

## MarkdownView public API and document search DOM

Evidence sources: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/Obsidian-Reconstructed/src/styles/app.css`.

- `obsidian.d.ts` declares `MarkdownView extends TextFileView implements MarkdownFileInfo` with public `editor`, `previewMode`, `currentMode`, `hoverPopover: HoverPopover | null`, `getMode()`, `getViewData()`, `clear()`, `setViewData(data, clear)`, and `showSearch(replace?: boolean)`.
- The original app stylesheet defines the document search/replace DOM contract under Markdown views: `.document-search-container`, `.document-search`, `.document-replace`, `.document-search-input`, `.document-replace-input`, `.document-search-count`, `.document-search-buttons`, `.document-replace-buttons`, `.document-search-button`, and the mode class `.mod-replace-mode`.
- The reconstruction now exposes `hoverPopover` on `MarkdownView` and implements `showSearch(replace?)` by creating that Obsidian-style search panel inside `.markdown-source-view.cm-s-obsidian.mod-cm6`, toggling `.is-searching`/`.is-replacing`, tracking match counts, navigating matches, and routing replace operations through the existing Markdown text buffer/edit pipeline.

## Workspace popout, active file, and leaf collection parity

Evidence sources: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` declares `Workspace.activeEditor: MarkdownFileInfo | null`, and `MarkdownFileInfo extends HoverParent` with public `app`, `file`, optional `editor`, and `hoverPopover`.
- The reconstruction now exports `HoverParent`, has `MarkdownFileInfo` extend it, and exposes `Workspace.activeEditor` as `MarkdownFileInfo | null` while keeping a private narrower guard for internal view/leaf operations.
- `obsidian.d.ts` declares `openPopoutLeaf(data?: WorkspaceWindowInitData): WorkspaceLeaf` but `moveLeafToPopout(leaf, data?): WorkspaceWindow`, so migrating an existing leaf returns the window container while opening a new popout returns the created leaf.
- `WorkspaceWindowInitData` carries `x`, `y`, and suggested `size`, matching the reconstructed `WorkspaceWindow` state fields. The reconstruction now passes this data into both public popout paths.
- The original runtime's `createLeafInParent(parent, index)` directly creates a `WorkspaceLeaf` and inserts it into the provided `WorkspaceSplit`. The reconstruction now follows that public API behavior instead of wrapping the new leaf in a fresh `WorkspaceTabs` group.
- The original runtime's `getLeavesOfType(type)` only collects leaves whose current `view.getViewType()` matches. The reconstruction now keeps that public behavior, while `ensureSideLeaf` uses a private pending-type lookup so deferred side leaf reuse still works without widening the public API.
- The original runtime's `getActiveFile()` falls back through the most recent active `FileView` rather than only a cached path. The reconstruction now scans navigable leaves for the most recently active file view after checking `activeEditor`.
- The original runtime's `getMostRecentLeaf()` searches the relevant root/floating scope, prefers visible leaves by `activeTime`, and falls back to the first leaf in that scope. The reconstruction now follows that scoped fallback instead of returning a hidden leaf or unrelated active leaf.
- The original runtime duplicates a leaf's ephemeral state with `{ focus: true }`. The reconstruction now merges that flag before loading the duplicate view state, preserving existing scroll/line state while focusing the new leaf.

## Workspace public event overloads

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares typed `Workspace.on(...)` overloads for public events including `quick-preview`, `resize`, `active-leaf-change`, `file-open`, `layout-change`, `window-open`, `window-close`, `css-change`, `file-menu`, `files-menu`, `url-menu`, `editor-menu`, `editor-change`, `editor-paste`, `editor-drop`, and `quit`.
- The reconstruction already emitted most of these events through the generic `Events` base class. This pass adds Workspace-specific overloads so plugin code sees the Obsidian payload types while preserving the generic fallback for internal/non-public events such as `leaf-menu`, `hover-link`, `markdown-viewport-menu`, and `editor-selection-change`.
- `obsidian.d.ts` declares a public `Tasks` class for the `quit` event with `add`, `addPromise`, `isEmpty`, and `promise`. The reconstruction now exposes `Tasks` under that official name, keeps `QuitEvent` as an internal-compatible subclass, and exports `Tasks` through the plugin module facade.

## WorkspaceLeaf public view and event surface

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `WorkspaceLeaf.view: View`, not nullable. The reconstruction already uses `EmptyView` as the runtime fallback; this pass tightens the public field to non-null while keeping the internal empty-view path private.
- `obsidian.d.ts` exposes `WorkspaceLeaf.open(view: View): Promise<View>`. The reconstruction now keeps `open(null)` as a private helper path and exposes only the official `open(view)` signature.
- `obsidian.d.ts` declares typed `WorkspaceLeaf.on('pinned-change', ...)` and `WorkspaceLeaf.on('group-change', ...)` overloads. The reconstruction now adds those overloads while preserving the generic fallback for internal leaf events.
- `obsidian.d.ts` declares `OpenViewState` with `state`, `eState`, `active`, and `group?: WorkspaceLeaf`. The reconstruction now keeps that exported shape for `WorkspaceLeaf.openFile/openLinkText`; extra project conveniences such as `Workspace.openFile(..., { mode })` live in an internal workspace-open state type instead of widening the plugin API.

## HoverPopover public constructor and lifecycle

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `HoverPopover extends Component`, public `hoverEl`, `state: PopoverState`, and constructor `(parent: HoverParent, targetEl: HTMLElement | null, waitTime?, staticPos?)`.
- The reconstruction now keeps the existing internal `new HoverPopover(parentEl)` convenience path while also supporting the official constructor. Official construction replaces `parent.hoverPopover`, stores `waitTime`/`staticPos`, starts the target hover flow when a target is provided, and clears `parent.hoverPopover` when hidden/unloaded.
- `PopoverState` is now exported as the official enum name for the existing hover popover state values; `HoverPopoverState` remains a same-value compatibility alias.

## View state payload contract

Evidence sources: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` declares `View.getState(): Record<string, unknown>` and `ViewState` as the wrapper object with `type`, optional `state`, `active`, `pinned`, and `group`.
- `obsidian.d.ts` declares public `ViewState.state?: Record<string, unknown>` and `group?: WorkspaceLeaf`. The reconstruction now keeps that exported shape for plugin-facing code, while `InternalViewState` carries layout/history-only metadata such as serialized group ids plus `icon` and `title`.
- The original runtime has individual views return only their payload state; `WorkspaceLeaf.getViewState()` then creates the `{ type, state, icon, title, group, pinned }` wrapper.
- The reconstruction now follows that split: base `View`, `FileView`, `MarkdownView`, `DeferredView`, `UnknownView`, `GraphView`, `SearchView`, `WebViewerView`, and `ReleaseNotesView` return payload objects, while `WorkspaceLeaf.getViewState()` wraps them. This prevents plugin custom views from losing state or getting nested as `{ state: { type, state } }`.
- Deferred leaves now preserve updated ephemeral state before their real view is loaded: `WorkspaceLeaf.setEphemeralState()` updates the stored deferred eState and the active `DeferredView`, so `loadIfDeferred()` restores the latest `{ focus, line, subpath }` style payload.
- `MarkdownView.clear()` now clears the base text buffer plus all Markdown modes, fold/scroll metadata, transient property state, and document-search match state before rerendering. This matches the runtime pattern where clear is a MarkdownView-level operation rather than only a TextFileView source-buffer reset.

## Top-level YAML and moment plugin exports

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` imports Moment as a top-level dependency and declares `export const moment: typeof Moment`, so plugins expect the Obsidian module facade to provide the callable Moment factory rather than requiring each plugin to bundle its own copy.
- `obsidian.d.ts` declares `parseYaml(yaml: string): any` and `stringifyYaml(obj: any): string` as public helpers. The reconstruction now backs these helpers with a real YAML implementation and exposes them through both the top-level package exports and the plugin module facade.

## Platform singleton API

Evidence sources: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` declares `Platform` as an exported singleton object, not a class, with mutable public fields for UI mode, app host, OS/browser flags, and `resourcePathPrefix`.
- The original runtime initializes and mutates this singleton during platform startup: desktop startup marks `isDesktopApp` and `isDesktop`, while mobile startup marks the mobile app and phone/tablet mode. The reconstruction now exposes the same public field set as a mutable object and keeps the desktop reconstruction default in desktop mode.

## Vault file tree public metadata

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `TAbstractFile` with public `vault`, `path`, `name`, and `parent: TFolder | null`, so files and folders need back-references into the owning vault and tree parent instead of relying only on path parsing.
- `obsidian.d.ts` declares `TFolder.children` plus `isRoot()` and `Vault.getRoot(): TFolder`. The reconstruction now maintains parent pointers when attaching, detaching, deleting, and renaming files, while preserving the existing internal `root` field for project code that already uses it.

## Markdown rendering loader helpers

Evidence sources: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/along/.context/obsidian-reference/app.js`.

- `obsidian.d.ts` declares public top-level helpers `loadMathJax`, `loadMermaid`, `loadPdfJs`, `loadPrism`, `renderMath`, and `finishRenderMath`; plugins commonly import these from the `obsidian` module even when they are not using `MarkdownRenderer` directly.
- The original runtime wires these helpers to lazy cached script/module loaders for MathJax, Mermaid, PDF.js, and Prism, then exposes `renderMath(source, display): HTMLElement` and a batched MathJax stylesheet flush. The reconstruction now exposes the same public function set through the top-level API and plugin module facade, returning existing global engines when present and installing lightweight fallback globals otherwise.
- The default Markdown `math` and `mermaid` code block processors now consume the same public helper path instead of rendering placeholder text, so preview rendering and plugin-imported helpers stay on one shared compatibility surface.

## Small plugin utility and component parity

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `getLanguage(): string`, `Keymap.isModifier(evt, modifier)`, `ButtonComponent.setDestructive()` / `removeDestructive()`, `SecretComponent`, and `FileSystemAdapter.readLocalFile()` / `mkdir()` as public APIs. These are small but common plugin compatibility points.
- The reconstruction now exposes those helpers through their native modules and the plugin facade where applicable: language defaults to `en`, Keymap handles the official `Mod`/`Ctrl`/`Meta`/`Shift`/`Alt` modifier set, destructive buttons use `mod-destructive`, secret inputs are password text components, and FileSystemAdapter static helpers route to the local desktop filesystem module.
- The public type surface now also exports the official small utility names used by plugins: `Constructor`, `RGB`, `HSL`, `Side`, `TooltipPlacement`, `IconName`, `MenuPositionDef`, plus `KeymapInfo`, `KeymapContext`, and `KeymapEventListener` over the existing keymap event pipeline.

## Metadata reference iteration helpers

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `Reference`, `ReferenceCache`, `LinkCache`, `EmbedCache`, `FrontmatterLinkCache`, `iterateRefs(refs, cb)`, and deprecated `iterateCacheRefs(cache, cb)`.
- The reference docs describe `iterateCacheRefs` as iterating links and embeds and stopping when the callback returns `true`. The reconstruction now exports the same helper behavior over `CachedMetadata.links` and `CachedMetadata.embeds`, while `iterateRefs` works over any `Reference[]`, including frontmatter links.

## ConfirmationModal and ConfirmationButton

Evidence sources: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/Obsidian-Reconstructed/src/styles/app.css`.

- `obsidian.d.ts` declares `ConfirmationButton extends ButtonComponent` with `onClick`, `setInitialFocus`, `setSecondary`, and `setCancel`, and declares `ConfirmationModal extends Modal` with `buttonContainerEl`, `addClass`, `addCheckbox`, `addButton`, and `addCancelButton`.
- The original stylesheet defines the confirmation modal and button-row class contract through `.mod-confirmation`, `.modal-button-container .mod-checkbox`, `.mod-secondary`, `.mod-cancel`, and `button.mod-destructive`. The reconstruction now builds that DOM/class shape and closes confirmation buttons after their handler resolves unless the handler returns a truthy value.

## Bases Value model

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares the Bases formula/value model as public plugin API: `Value`, `NotNullValue`, `NullValue`, `PrimitiveValue`, `StringValue`, `NumberValue`, `BooleanValue`, `DateValue`, `LinkValue`, `ListValue`, `ObjectValue`, and `UrlValue`.
- The reconstruction now provides this value family as a real runtime model with singleton null values, primitive truthiness/equality, date parsing/date-only/relative helpers, wikilink parsing/rendering, lazy list/object wrapping, and plugin module exports. The 1.10 value subclasses (`DurationValue`, `FileValue`, `HTMLValue`, `IconValue`, `ImageValue`, `RegExpValue`, `RelativeDateValue`, and `TagValue`) are also exported through the plugin facade, with Duration carrying ISO-8601 parsing/millisecond/date-offset behavior.
- `BasesEntry.getValue()` and `BasesQueryResult` now wrap query output in those `Value` objects while keeping the existing row/cell render adapter intact. This moves the public Bases data model toward Obsidian without breaking the reconstructed table/cards/list renderers that still consume `rows` and `display` fields.
- `obsidian.d.ts` declares `BasesEntry.file: TFile`. The reconstruction now carries the real vault `TFile` through `FileProperties`, exposes it on each `BasesEntry`, and derives file properties such as `basename`, `folder`, `ext`, `ctime`, `mtime`, and `size` from the `TFile` instead of path-only approximations.

## Bases QueryController and plugin view factory bridge

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `BasesViewFactory = (controller: QueryController, containerEl: HTMLElement) => BasesView`, `BasesViewRegistration` with `name`, `icon`, `factory`, and `options`, and `BasesView` with a `QueryController` constructor.
- The reconstruction now introduces `QueryController`, exports Bases view/query classes through the plugin facade, lets `BasesView` accept either the official controller or the older internal context, and lets plugin Bases views render through the official `factory(controller, containerEl)` path while preserving the built-in table/cards/list renderer path.
- `app.js` routes `Plugin.registerBasesView` through the enabled Bases core plugin instance and returns `false` when Bases is disabled. The reconstruction now gives the Bases core plugin a controller instance with `registerView`/`deregisterView` and makes plugin registrations delegate through that enabled controller instead of writing directly to the registry.
- The Bases registry now also exposes runtime-like aliases `registerView`, `deregisterView`, `getRegistration`, `getRegistrations`, and `getViewFactory` over the same registration store, matching the method names seen on the original Bases core plugin object while keeping older internal registry call sites intact.
- Built-in table, cards, and list Bases renderers now register as factory-backed `BasesView` subclasses too. This removes the old parallel `render(context)` / `createView(context)` path from `renderBases()`, so built-in and plugin views share the same `QueryController` and `BasesView.onDataUpdated()` lifecycle.

## BasesViewConfig view-scoped configuration

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `BasesViewConfig` as the in-memory representation of a single entry in the Base file `views` section, with `name`, `get`, `set`, `getAsPropertyId`, `getEvaluatedFormula`, `getOrder`, `getSort`, and `getDisplayName`.
- The reconstruction now separates the whole base file config as `BasesFileConfig` and uses `BasesViewConfig` for the public per-view object exposed through `QueryController` and plugin custom views. Existing built-in renderers still receive the whole `BasesFileConfig`, so table/cards/list behavior remains intact while plugin-facing config moves toward the official shape.

## Editor extension public facade bridge

Evidence sources: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and `/Users/cardcunningham/Projects/Obsidian-Reconstructed/src/editor/EditorExtension.ts`.

- `obsidian.d.ts` exposes editor state fields such as `editorEditorField`, `editorInfoField`, `editorViewField`, and `editorLivePreviewField` to plugin code, while the reconstruction already routes plugin extensions through `Plugin.registerEditorExtension(...)` and `Workspace.registerEditorExtension(...)`.
- The plugin module facade now exports the reconstructed editor field objects, `StateEffect`, `StateField`, `Transaction`, `livePreviewState`, and the editor extension helper factories (`editorDomClass`, `editorTransactionFilter`, `editorUpdateListener`, `editorViewPlugin`). This closes the plugin-facing chain: plugins can import the same public fields/helpers from the Obsidian module that the reconstructed editor host consumes at runtime.

## Plugin facade runtime constructors and raw vault adapter

Evidence sources: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts` and the reconstructed app startup chain.

- `obsidian.d.ts` exposes runtime constructors/singletons such as `App`, `RenderContext`, `SettingPage`, `AbstractTextComponent`, and `PopoverState`, not just an `app` instance. The plugin module facade now exports those runtime values, and `RenderContext` implements the `HoverParent` shape with a `hoverPopover` slot.
- Obsidian's app startup creates a Vault backed by a concrete adapter; plugins commonly reach for `app.vault.adapter` when they need raw adapter operations. The reconstruction now gives the default `App` vault an `InMemoryAdapter`, so plugin code can use `read`, `write`, `stat`, `list`, `process`, and `getResourcePath` through the public adapter entrypoint even when no desktop filesystem adapter is injected.
- The remaining official runtime names from `obsidian.d.ts` are also bridged where the reconstruction already has matching behavior: `CapacitorAdapter` is a mobile-named `DataAdapter` implementation backed by the same in-memory adapter behavior, including the official `getFullPath()` method and mobile-style resource paths; `WorkspaceMobileDrawer` is exported as the same constructor value as the reconstructed `MobileDrawer`; and `MarkdownEditView` is the exported edit-mode subview used by `MarkdownView`.

## Debouncer facade semantics

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` declares `debounce<T,V>(cb, timeout?, resetTimer?): Debouncer<T,V>`, where invoking the debounced function returns `this`, `cancel()` returns `this`, and `run()` immediately executes any pending call and returns the callback result.
- The plugin module debounce implementation now follows that public Debouncer shape instead of returning a void-only callback. It tracks pending arguments, supports reset/no-reset timer behavior, exposes chainable `cancel()`, and lets plugin code flush pending work synchronously through `run()`.

## DataAdapter.list non-recursive semantics

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` documents `DataAdapter.list(normalizedPath)` as retrieving files and folders inside the given folder, non-recursive.
- The reconstruction now keeps both `InMemoryAdapter.list` and `FileSystemAdapter.list` to one directory level. Plugins that perform their own recursive traversal no longer receive all descendants at every level, which better matches Obsidian's raw adapter contract and avoids duplicate traversal work.

## FileManager.getNewFileParent extension-aware placement

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` documents `FileManager.getNewFileParent(sourcePath, newFilePath?)` as using `newFilePath` to infer which settings should decide the destination based on the new file extension.
- The reconstruction now keeps Markdown and Canvas files on the new-note path settings (`newFileLocation` / `newFileFolderPath`) while routing attachment-like extensions through `attachmentFolderPath`, including the existing root/current-folder/relative-subfolder rules used by attachment creation.

## MetadataCache linkpath source-folder boundary

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` describes `MetadataCache.getFirstLinkpathDest(linkpath, sourcePath)` as returning the best match for a linkpath.
- The reconstruction now treats same-folder candidates using a directory boundary instead of plain string prefix matching. A source in `A/` no longer considers `AA/Target.md` to be nearby simply because the path starts with `A`, which makes best-match link resolution safer for similarly named folders.

## Dynamic editor extension arrays

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` documents `Plugin.registerEditorExtension(extension)` as accepting a CodeMirror 6 extension or an array of extensions, and specifically says arrays can be modified dynamically then applied by calling `Workspace.updateOptions()`.
- The reconstruction now stores the original registered extension value and normalizes it each time editor options are requested. Already-open Markdown views therefore pick up mutations to a plugin-owned extension array after `workspace.updateOptions()`, matching the official dynamic reconfiguration pattern used by editor plugins.

## requestUrl platform bridge

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` describes `requestUrl` as fetch-like but without browser CORS restrictions, which implies a platform/native request layer rather than plain browser `fetch`.
- The plugin module now binds `requestUrl` and `request` to the current `App` instance. If the app shell bridge exposes a `request-url` handler, requests are routed through that platform bridge and normalized into Obsidian's `RequestUrlResponse` shape; otherwise the reconstruction keeps the existing browser `fetch` fallback for test and web environments.

## FileView public file lifecycle hooks

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` exposes `FileView.onLoadFile(file)`, `FileView.onUnloadFile(file)`, and `FileView.onRename(file)` as public lifecycle hooks for file-backed views.
- The reconstruction now keeps these hooks public, calls load/unload during file changes, and registers a vault rename listener while a FileView is open so custom file views can react when their current file is renamed.

## Obsidian protocol handler payload shape

Evidence source: `/Users/cardcunningham/Projects/along/.context/obsidian-reference/obsidian.d.ts`.

- `obsidian.d.ts` documents `registerObsidianProtocolHandler(action, handler)` as passing a decoded key-value object such as `{ action: "open", key: "value" }` to plugin handlers.
- `obsidian.d.ts` declares `ObsidianProtocolData` as `{ action: string; [key: string]: string | "true" }` and `ObsidianProtocolHandler = (params: ObsidianProtocolData) => any`; the public plugin/workspace registration path now exposes that official payload shape.
- Internal app protocol handlers register directly with `UriRouter` and still receive the extended context containing `params: URLSearchParams`, keeping built-in URI handlers convenient without leaking the internal field to plugins. Empty query flags are represented as `"true"`.

## ItemView header direct-child contract

- Evidence from `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` around `view-header-title-container`: ItemView creates `.view-header-left`, `.view-header-title-container`, and `.view-actions` as sibling children of `.view-header`.
- `src/views/ItemView.ts` follows that direct-child order so `app.css` flex and fade rules apply to the title area instead of being constrained by `.view-header-left`.

## Sidedock collapse width and visibility contract

- Evidence from `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` around `is-sidedock-collapsed`: collapse adds the collapsed class, drives the sidedock width toward `0`, hides the split, and expand shows it before restoring width.
- `src/workspace/WorkspaceSidedock.ts` keeps `width` as the remembered expanded width while collapse sets the DOM width to `0px` and hides the container, so layout persistence does not forget the user's expanded size.

## Sidebar toggle ownership contract

- Evidence from `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.css`: `.workspace-ribbon.mod-right { display: none; }`, while `.sidebar-toggle-button.mod-right` has its own icon orientation and open-state CSS.
- Evidence from `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` around `leftSidebarToggleButtonEl`, `rightSidebarToggleButtonEl`, and `updateFrameless`: toggles are Workspace-owned nodes and are reparented into ribbon/top-tab containers.
- `src/workspace/Workspace.ts` owns `leftSidebarToggleButtonEl` and `rightSidebarToggleButtonEl`; `WorkspaceRibbon.sidebarToggleButtonEl` is a compatibility alias. The right toggle is reparented into a visible top tab header instead of the hidden `.workspace-ribbon.mod-right`.

## Custom icon registry contract

- Evidence from `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` around `addIcon`, `getIcon`, and the observed `$m={viewBox:"0 0 100 100"}` custom icon options: plugin-added icons are stored separately from built-in icons and rendered with custom SVG content rather than the Lucide stroke wrapper.
- Evidence from `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` around `function tv(e,t)`: `setIcon` checks the existing first child against the raw requested icon string, removes only the first child when rebuilding, and clears stale icons when the requested icon is unknown.
- `src/ui/Icon.ts` keeps built-in and custom icon registries separate. Custom icons use raw keys, can temporarily override built-ins, render with `viewBox="0 0 100 100"` without Lucide width/height/stroke attributes, and `removeIcon()` restores the built-in icon when one exists.

## WorkspaceTabs tab state contract

- Evidence from `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` around `updateTabDisplay`: tab headers toggle `is-active`, leaves toggle display/visibility, and current observed snippets do not use `is-before-active` or `data-index` for tab headers.
- `src/workspace/WorkspaceTabs.ts` avoids inventing those non-observed state markers so the generated DOM stays closer to the real Obsidian tab header language.
- Evidence from the same `updateTabDisplay` area: non-stacked tab header insertion animates `width: 0 -> measured px` and `opacity: 0 -> 1` for 200ms; removal animates a measured clone from `width: measured px -> 0` and `opacity: 1 -> 0`.
- `src/workspace/WorkspaceTabs.ts` now diffs non-stacked tab headers through `syncTabHeadersWithAnimation`, while stacked mode keeps the observed header/container reparenting path.

## Workspace createLeafInParent and duplicateLeaf pane routing evidence

Evidence source: `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` from Obsidian 1.12.7.

Observed offsets in the single-line renderer bundle:

- `app.js:1:254964`: export table maps `WorkspaceLeaf` to `jD`, `WorkspaceSplit` to `OD`, and `WorkspaceTabs` to `zD`.
- `app.js:1:2717340`: `createLeafInParent(parent, index)` creates `new WorkspaceLeaf`, optionally sets dimension, directly calls `parent.insertChild(index, leaf)`, activates it, and returns the leaf. It does not create a `WorkspaceTabs` wrapper.
- `app.js:1:2717518`: `splitLeaf` is the path that wraps a non-tabs source with `WorkspaceTabs.createFrom(...)`.
- `app.js:1:2718403`: `duplicateLeaf` normalizes `horizontal`/`vertical` into `split`, then uses `createLeafBySplit(source, direction)` only for split; all other pane targets go through `getLeaf(target)`.
- `app.js:1:2719392`: `getLeaf("tab")` and `getLeaf(true)` both call `createLeafInTabGroup()`.
- `app.js:1:2719573`: `createLeafInTabGroup()` without an explicit group uses `getMostRecentLeaf().parent`, inserts after that group's most recent child, and can reuse an empty view leaf.

Clean-room implications:

- Keep `Workspace.createLeafInParent(parent, index)` as a direct leaf insertion API.
- Keep `duplicateLeaf(source, "tab")` and `duplicateLeaf(source, true)` routed through the current/most-recent tab group, not through `source.parent` unless the source is itself the most-recent leaf.
- Keep literal `duplicateLeaf(source, "split")` on the source-based split path, with `horizontal`/`vertical` accepted as direction aliases.

## Workspace view lookup evidence

Evidence source: `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` from Obsidian 1.12.7.

Observed offsets in the single-line renderer bundle:

- `app.js:1:2725797`: `getLeavesOfType(type)` iterates all leaves and includes a leaf only when `leaf.view.getViewType() === type`.
- `app.js:1:2724000`: `getActiveViewOfType(ctor)` checks `activeLeaf.view` and returns it only when it is `instanceof ctor`.

Clean-room implications:

- Keep public `Workspace.getLeavesOfType(type)` as a simple `leaf.view.getViewType() === type` lookup.
- Deferred placeholder leaves are included because the placeholder is the current `leaf.view` and its `getViewType()` returns the target type.
- Do not add a separate non-view `pendingViewType` lookup path; side-view reuse should come from the deferred placeholder view itself.

Additional observed offsets:

- `app.js:1:1354742`: deferred placeholder `eD` stores `viewType` and `getViewType()` returns that target type.
- `app.js:1:1406511`: hidden leaf `setViewState` can create the deferred placeholder when icon/title are present.
- `app.js:1:1407963`: `loadIfDeferred()` rerenders only when current `leaf.view` is the deferred placeholder.

## Workspace active file lookup evidence

Evidence source: `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` from Obsidian 1.12.7.

Observed offsets in the single-line renderer bundle:

- `app.js:1:2724127`: `getActiveFileView()` first checks `activeLeaf`; when `activeLeaf.view.navigation` is true it returns the view only if it is the file/markdown view class, otherwise it returns `null`.
- `app.js:1:2724413`: `getActiveFile()` returns `activeEditor?.file || getActiveFileView()?.file || null`.

Clean-room implications:

- If the active view is navigable but not a file view, `Workspace.getActiveFile()` should return `null` rather than falling back to an older file view.
- Fallback to the most recent navigable file view is only used when the active view itself is not navigable.

## View registry, unknown view, and deferred view evidence

Evidence source: `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` from Obsidian 1.12.7.

Observed offsets in the single-line renderer bundle:

- `app.js:1:2616873`: `ViewRegistry.registerView(type, creator)` stores the creator and triggers `view-registered`.
- `app.js:1:2617003`: `ViewRegistry.unregisterView(type)` deletes the creator and triggers `view-unregistered`.
- `app.js:1:2677266` and `app.js:1:2677309`: workspace listens to both `view-registered` and `view-unregistered`, then rebuilds existing leaves of that type by saving view state, opening the empty view, and setting the saved state again.
- `app.js:1:2739647`: `Plugin.registerView(type, creator)` delegates to `app.viewRegistry.registerView`.
- `app.js:1:2739821`: plugin cleanup unregisters the view, and detaches leaves only when `_userDisabled` is true.
- `app.js:1:1406939`: unregistered non-empty view types fall back to the unknown pane view.
- `app.js:1:1357674`: unknown pane view stores the original view type, returns it as display/view type, uses `lucide-ghost`, and preserves state.
- `app.js:1:1406511`: deferred view is only created when a creator exists, there is no previous history state, current view is not already deferred, icon is truthy, title is not undefined, and the leaf container is not shown.

Clean-room implications:

- View ownership belongs to `app.viewRegistry`; plugin APIs are lifecycle helpers around that registry.
- Unknown plugin panes should survive until the plugin registers their view type, then rebuild into the real view.
- User-disabled plugins additionally detach their registered view leaves.
- Deferred view eligibility should use visibility and title/icon presence, not only inline `style.display` or string type checks.

## ItemView header action and navigation evidence

Evidence source: `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` from Obsidian 1.12.7.

Observed offsets in the single-line renderer bundle:

- `app.js:1:1051763`: `ItemView` creates `.view-header-title-container.mod-at-start`, `.view-header-title-parent`, and `.view-header-title` as direct children under `.view-header`.
- `app.js:1:1052218`: the title container gets `mod-fade`, and `mod-at-start` / `mod-at-end` are updated from title scroll position.
- `app.js:1:1052148` and helper `app.js:1:551971`: the title scroll listener is wrapped as `wc(update, 10)`, so scroll fade state is updated through the shared short timer helper instead of synchronously on every scroll event.
- `app.js:1:1365520`: `FileView.renderBreadcrumbs()` clears `titleParentEl`, creates `.view-header-breadcrumb` spans plus `.view-header-breadcrumb-separator` slash nodes from the current file parent path, reveals folders through file explorer on click, opens the folder file-menu on contextmenu, and wires folder drag sources.
- `app.js:1:1052845`: `updateNavButtons()` sets back/forward `ariaDisabled` from leaf history lengths.
- `app.js:1:1053246`: `ItemView.load()` registers leaf `group-change` and `history-change` listeners.
- `app.js:1:1053571`: `addAction(icon,title,callback)` creates `button.clickable-icon.view-action`, prepends it into `.view-actions`, sets icon/tooltip, prevents mousedown default, and invokes callback for primary/middle click.
- `app.js:1:1053861`: more-options menu creates sections, calls `onPaneMenu(menu, "more-options")`, `onMoreOptionsMenu(menu)`, and triggers workspace `leaf-menu`.

Clean-room implications:

- Custom ItemView-derived plugin views should get stable header/action behavior without each view rebuilding the header contract.
- Back/forward buttons must update on `history-change`, not only when the whole leaf header is refreshed.
- Title fade classes belong to the title container and are driven by title scroll position.

## ItemView more-options hook evidence

Evidence source: `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` from Obsidian 1.12.7.

Observed offsets in the single-line renderer bundle:

- `app.js:1:1058831`: `ItemView.onMoreOptions(event)` creates the standard pane menu sections, configures `info.copy` with `lucide-clipboard`, calls `onPaneMenu(menu, "more-options")`, calls `onMoreOptionsMenu(menu)`, then triggers workspace `leaf-menu`.
- `app.js:1:1058171`: `ItemView.addAction(icon,title,callback)` prepends a `button.clickable-icon.view-action`, prevents `mousedown` default, and invokes callbacks only for left/middle click.

Clean-room implication: plugin ItemViews can rely on `onPaneMenu(menu, "more-options")` and `onMoreOptionsMenu(menu)` as the standard extension path for header more-options behavior.

Additional ItemView menu parity points:

- `app.js:1:1052410` and `app.js:1:1052704`: the more-options button callback checks `.has-active-menu` before calling `onMoreOptions()`.
- `app.js:1:1053998`: more-options uses sections `close`, `pane`, `open`, `action`, `find`, `info`, `info.copy`, `view`, `view.linked`, `system`, `""`, and `danger`.
- `app.js:1:1055242` and `app.js:1:1055437`: Split right/down menu items call `workspace.duplicateLeaf(leaf, "vertical")` and `workspace.duplicateLeaf(leaf, "horizontal")`.
- `app.js:1:1056018` and `app.js:1:2714876`: Link tab calls `workspace.onStartLink(leaf)`, which starts a mouse flow and finally calls `sourceLeaf.setGroupMember(targetLeaf)` when released over another ItemView leaf.
- `app.js:1:1056316`: Move to new window remains a tab-menu action and calls `workspace.moveLeafToPopout(leaf)`.
- `app.js:1:2313084`: file-backed views forward pane menus into `workspace.file-menu(menu, file, source, leaf)`, making `view.linked` plugin items available from both tab header and more-options menus.
- `app.js:1:2544507`, `1:2854249`, `1:3282753`, `1:3299772`, and `1:3315083`: built-in linked-view submenu item titles are `Open local graph`, `Open backlinks`, `Open outgoing links`, `Open outline`, and `Open file properties`; only the submenu heading itself is `Open linked view`.
- `app.js:1:2854673`: the Backlinks plugin contributes both an `Open backlinks` linked-view menu item and, when the source leaf view can toggle embedded backlinks, a `pane` item checked from the Markdown view state that toggles backlinks in the document.
- `app.js:1:2718297`: `workspace.splitLeafOrActive(source, direction)` only delegates to `createLeafBySplit` or `splitActiveLeaf`; it does not copy `source.group`. Linked-view grouping comes from the later `setViewState({ group: sourceLeaf })` call.

## ItemView navigation history parity evidence

Evidence source: `/Users/cardcunningham/Projects/decode-obsidian/ref/obsidian/app.js` and `/Users/cardcunningham/Projects/decode-obsidian/.agents/skills/obsidian-reverse-profile/reference/view-api.md`.

- `ItemView.updateNavButtons()` reads `leaf.history.backHistory.length` and `leaf.history.forwardHistory.length`, so the disabled state tracks the public history object instead of private leaf fields.
- The observed navigation helper calls `leaf.history.go(-1)` / `leaf.history.go(1)` for plain clicks.
- Modifier-click first duplicates the source leaf through the workspace pane-target path, then navigates the duplicated leaf.
- The history context menu is built from the corresponding history array by iterating from the array tail to the head for both Back and Forward. Titles come from `entry.title` through `gc(title, 50)`, icons come from `entry.icon`, and callbacks compute `delta = history.length - originalIndex`, negating it for Back.
- Menu item callbacks also support modifier-click duplication before calling `history.go(delta)` on the chosen leaf.
- `app.js:1:1047681`: the same helper opens the history menu on `contextmenu`, 400ms long press, or downward drag after `dx*dx + dy*dy > 25` when vertical downward motion is greater than horizontal motion; long-press menus forward a following `mouseup` to the menu item under the pointer.
- `src/views/ItemView.ts` now keeps this behavior in the shared base ItemView header path, with focused coverage in `src/views/ViewApiParity.test.ts`.
- Obsidian WorkspaceItem resize handle and parent insertion: `app.js` around `1:1375266` creates `hr.workspace-leaf-resize-handle` in the item container; `WorkspaceParent.insertChild` around `1:1376967` anchors insertion to `children[index]?.containerEl`, preserving the parent handle before managed child containers.
- Obsidian WorkspaceLeaf.open view DOM lifecycle: `app.js` around `1:1405850` calls `containerEl.setChildrenInPlace([resizeHandleEl])` before `view.open(containerEl)`, so stale view content is removed and the current `.workspace-leaf-content` is appended after the resize handle.
- Obsidian WorkspaceLeaf.open close-await boundary: `app.js` around `1:1410198` calls old `view.close()`, but skips awaiting close for `DeferredView` and the `EmptyView` family (`t instanceof eD || t instanceof tD`), while still running synchronous detach/unload before the next view is opened.
- Obsidian WorkspaceTabs deferred loading: `app.js` around `1:1395178` loads deferred leaves in stacked tab ordering, and the non-stacked path later calls `loadIfDeferred()` for the active leaf when the tab group is shown after header/container display state has settled.
- Obsidian stacked selectTabIndex hidden ordering: `app.js` around `1:1394303` sets `currentTab`, calls `updateTabDisplay()`, then removes `is-hidden` from the active stacked leaf and calls `scrollIntoView`; `onContainerScroll` around `1:1399659` owns stacked `toggleClass("is-hidden", ...)` for offscreen non-active leaves.
- Obsidian WorkspaceTabs.selectTabIndex unchanged semantics: `app.js` around `1:1394303` wraps all side effects in `currentTab !== index`; unchanged index does not update display, activate leaf, save layout, resize, or scroll. Header click around `1:1389352` calls `selectTabIndex(n)` and then explicitly `workspace.setActiveLeaf(leaf,{focus:true})`.
