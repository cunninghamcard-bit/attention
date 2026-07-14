---
record: 0004
goal: theme style settings
round: what "align with Obsidian's settings architecture" actually means
status: confirmed
---

# Obsidian has no precedent for half of what this feature needs

The user asked for the Style Settings surface to be built "the way Obsidian
does it". Reading `decode-obsidian/ref/obsidian/app.js` and `app.css` shows
that for two of the three hard parts, **Obsidian does not do it at all** — and
for the third, the repo has drifted away from Obsidian without noticing.

## 1. Obsidian's settings have no collapsible sections. None.

`grep -i "setting.*collaps\|collaps.*setting"` over `app.css` returns zero
matches. There is no `.setting-group.is-collapsed`, no
`.setting-item-heading .collapse-icon`, no `mod-collapsible` on a settings
selector. `SettingGroup` (minified `qk`) has no collapse method, no click
handler on `headerEl`, no state class. `Setting.setHeading()` only adds a
cosmetic class. Obsidian's settings groups are always-open flat cards; its only
"hide complexity" mechanism is opening a separate modal.

The Primary theme declares **69 headings, all `collapsed: true`, nested 4
levels deep**. Collapsibility is therefore forced by the data and cannot be
copied from anywhere. It is a net-new invention either way.

## 2. Obsidian's settings have no global search.

The settings modal chrome creates no search input (`grep -c setting-search` over
app.js = 0; app.css has no settings-search class). Search exists only *inside
individual tabs*, scoped to a single `SettingGroup`, and every core
implementation **empties `listEl` and recreates only the matching rows** rather
than hiding them — core plugins, hotkeys, pinned commands all follow this shape:

```js
o = function(e){ i.listEl.empty(); … if (e && !h && !p) return "continue"; i.addSetting(…) }
```

The group heading is never hidden; an empty group collapses only via the CSS
rule `.setting-group .setting-items:empty { display: none }`.

## 3. Obsidian's settings tabs are 100% imperative. The repo's declarative engine is an invention — and a broken one.

Every real Obsidian setting tab is written as:

```js
t.prototype.display = function () {
  var t = this.containerEl; t.empty();
  new qk(t).addSetting(function (t) { return t.setName(…).addToggle(…) }).addSetting(…)
}
```

There is **no** `getSettingDefinitions()`, no `SettingDefinition` object model,
no `refreshDomState()`, no `displayDeclarative()`, no
`type: "group" | "list" | "page"` union anywhere in app.js. Obsidian's
equivalent of a `visible` predicate is inline imperative code wired from the
relevant `onChange`.

`src/renderer/app/SettingTab.ts` invented all of it. It is also unfit for this
feature on its own terms:

- **A group cannot nest inside a group.** `SettingDefinitionGroup.items` is
  typed `SettingGroupItem[]` (:180), and that union (:167-169) admits only
  `SettingDefinition | SettingDefinitionPage`. The renderer agrees —
  `renderGroupItem` (:501-514) dispatches page-vs-definition only.
- **The drill-down page mechanism is broken below depth 2.** `openPage`
  (:736-768) renders a back button that calls `displayDeclarative()` (:754-756),
  which re-renders the **root** item list. There is no page stack, so "back"
  from a level-3 page lands at the root, not the parent.
- It references classes with **zero CSS anywhere in the repo**: `setting-page`,
  `vertical-tab-header-search`, `setting-item-display-value`, `setting-list*`.
- No builtin tab uses it. Every builtin (`AppearanceSettingTab`,
  `FilesSettingTab`, `HotkeysSettingTab`, …) is `implements SettingTab`,
  imperative — i.e. every builtin already agrees with Obsidian, and only the
  unused engine disagrees.

`SettingGroup` itself (`src/renderer/ui/Setting.ts:693`) IS a faithful port of
`qk` — same DOM, same `setHeading` prepend/detach logic, same `addSearch`. The
primitive is sound; the layer invented on top of it is not.

## Decision

"Align with Obsidian" resolves, counter-intuitively, to:

1. **Build the Style Settings tab imperatively**, on the faithful `SettingGroup`
   primitive, like every real Obsidian tab and every builtin in this repo. Do
   not extend the invented declarative engine — doing so would deepen a
   divergence from Obsidian, not close it.
2. **Collapsible headings and an alpha colour control have no Obsidian
   precedent** and must be invented. Invent them *in Obsidian's idiom* — compose
   existing primitives (`.collapse-icon` + `right-triangle`, `ColorComponent` +
   `SliderComponent`) rather than importing foreign machinery.
3. Because the tab owns its own parsed model, ancestor-aware search
   (a match force-expands its ancestors; a heading with no matching descendants
   hides) is straightforward here — and impossible in the declarative engine,
   whose `RenderedDomState` (:264-270) holds three predicates and two mutators
   with **no identity, no path, and no parent link**.
