# Research result

**Status: Partial**

Native attention should keep the two appearance controls it already ships, restore accent color and the original three font roles with the 10–30 size clamp, and add a thin non-color layer—line height, light/dark theme and icon-theme choice, syntax font style, file-tree density, and a few chrome toggles—on the mygo theme objects the UI already has but does not configure. Community CSS themes and CSS snippets should stay out of v1, because they inject stylesheets into a document, while the native window only installs `theme.For(dark, "default")`. Advanced desktop-shell controls (zoom, native menus, frame style, custom icon, translucency, hardware acceleration) stay out as well.

### Original appearance

The settings page is five groups. Theme is the base scheme (`system`, `moonstone`, or `obsidian`), an accent picker, and a community-theme dropdown bound to vault config `cssTheme`, plus Manage. Interface is inline title (default off), view header (default on), ribbon (default on), and optional ribbon configuration. Font is separate interface, text, and monospace controls plus a size slider limited to 10–30 in steps of 1, default 16. Advanced is desktop zoom, native menus, frame style, custom icon, translucency, and hardware acceleration. The last group toggles CSS snippets. [S1]

A normalized accent hex is written as body `--accent-h`, `--accent-s` and `--accent-l` (the last two as percents), and as documentElement `--interactive-accent`. A light accent also sets body `--text-on-accent` to `var(--text-on-accent-inverted)`. An empty or invalid color removes those properties. When no accent is stored, the getter falls back to the computed `--accent-h` / `--accent-s` / `--accent-l` values. [S2]

Font overrides are body `--font-interface-override`, `--font-text-override`, and `--font-monospace-override`, plus `--font-print-override` when the text font is non-empty, and documentElement `--font-text`, `--font-ui`, and `--font-monospace`. Base size is clamped to 10–30 and applied both as body `--font-text-size` in pixels and as the documentElement `font-size`. [S3]

The community theme is whatever id is in `cssTheme`. Setting it stores that id; a non-empty id requests a theme load, debounced 100ms, which then loads and applies the configured theme. A registered theme writes its variables on documentElement and its `cssText` into the main theme style element. An unregistered id is read from `configDir/themes/<id>.css` when the id is legacy-only, otherwise from `configDir/themes/<id>/theme.css`, and that CSS is injected only if `cssTheme` still matches. An empty id clears the theme style element. [S4]

Snippets are `configDir/snippets/<id>.css`. The settings toggle persists `enabledCssSnippets` and reloads snippets; the load path registers or unregisters each snippet’s style, and those updates emit `css-change` with reason `snippet:<id>`. [S5]

### What the native port actually changes

The Go Appearance tab draws only a base color scheme selector and an Interface group with a Show ribbon switch. The same function states that accent color, fonts, zoom, themes, and CSS snippets are not ported. [S6] The scheme is the appearance key `theme`, stored as `system`, `moonstone`, or `obsidian`, labeled Adapt to system, Light, and Dark, and treated as `system` when the key is missing. [S7] `moonstone` forces light, `obsidian` forces dark, and every other value, including `system`, follows `Layout.IsDark`, which startup sets to `mygo.Theme.IsDark`. [S8] Show ribbon is the boolean appearance key `showRibbon`, and a missing value is treated as shown. [S9] The window root applies that light/dark bit with `theme.For(dark, "default")` and draws the left ribbon only when the ribbon is shown. [S10] Those writes go through the appearance settings API into `appearance.json` under the config directory, saved soon after the set. [S11] The attention-ui screen theme install does the same thing: it always calls `theme.For` with scheme `"default"`. [S12] The color-scheme argument therefore never leaves `"default"`; the tab only changes light/dark base scheme and ribbon visibility. [S13]

### Theme fields already in the toolkit, unused

Painting hardcodes shell metrics and does not set `Font`: scrollbar width 4, radius 8, spacing 8, and body font size 14. Nothing else under attention-ui or native assigns `Font`, `FontSize`, `Radius`, `Spacing`, or `ScrollbarWidth`. A comment that the shell replaces `FontSize` with a configured UI font size has no matching assignment. [S14]

`ui.Theme` already has `Font` (empty meaning the system font), `FontSize`, `Spacing`, `Radius`, and `ScrollbarWidth` (documented as 6 by default, including when the value is 0). Library light and dark themes use radius 6, spacing 4, and a default font size of 13 on darwin and 14 elsewhere, and leave `Font` and `ScrollbarWidth` unset—different metrics from the paint values above. Those fields are present both in the mygo version attention-ui pins and in the newer pseudo-version the native module selects. [S15]

The editor theme type already covers chrome and syntax: gutter, selection, cursor, guides, diagnostics, added/deleted/modified, and token styles. Its default fills code colors from a fixed GitHub palette, and a nil editor theme resolves to that default. The text view is opened without an editor theme, so it gets the GitHub default. [S16]

### Zed layers that are not colors

Zed separates three font layers—editor text, UI, and terminal—each with family, fallback, and size. The documented sample uses editor size 14, UI size 16, and terminal size 14. [S17] Editor line height is `buffer_line_height`: `"comfortable"` (ratio 1.618, the default), `"standard"` (1.3), or `{"custom": a ratio}`. [S18]

Icon themes are chosen with `icon_theme_selector::Toggle`, which previews while moving through the list and saves on Enter. `icon_theme` can set `mode` plus distinct `light` and `dark` names; mode `light` or `dark` ignores the system mode. [S19] The theme selector (`theme_selector::Toggle`) works the same way: live preview, Enter writes the choice. `theme` is either a name or an object with `mode`, `light`, and `dark`; the first mode toggle converts a static theme string into that object. [S20] Per-theme overrides live in `theme_overrides` keyed by theme name and can change non-color syntax, including comment `font_style` set to italic, alongside color keys. [S21]

File-tree density is `project_panel.entry_spacing` (`"comfortable"` or `"standard"`), with `indent_size` as pixels per indent. Chrome visibility is `tab_bar.show`, `tabs.file_icons`, `gutter.line_numbers`, and `scrollbar.show` (`auto`, `system`, `always`, or `never`). [S22]

### v1 decision

This section is the recommendation, not a further observation.

**Restore from the original app.** Keep base color scheme (`system` / `moonstone` / `obsidian`) and Show ribbon; they already persist in `appearance.json` and already drive light/dark and whether the ribbon is drawn. Add accent color as one stored color applied when the native theme is built, matching the original picker rather than new CSS variables on a document. Add the three font roles—interface, text, and monospace—and the base size clamp of 10–30, default 16, by assigning `ui.Theme.Font` and `FontSize`, which paint currently hardcodes and never reads from settings. Add the two other interface toggles that already have defaults in the original page: view header on, inline title off.

**Copy from Zed, mapped onto those same objects.** Treat fonts as Zed’s three layers: UI font as interface, editor font as text, and a terminal font beside them, each with family and size; fallbacks can wait until the toolkit can express them. Add editor line height with the same two presets (1.618 and 1.3) plus a custom ratio, stored next to the editor theme rather than as CSS. Store the chosen theme as either a name or `{mode, light, dark}`, and select it with a list that previews before commit, instead of only the system/light/dark switch. Do the same for an icon theme with separate light and dark names. Allow per-theme overrides of syntax font style (italic comments and the like) on the editor token styles, which today stay on the GitHub default because no editor theme is set. Add file-tree density as comfortable versus standard spacing, plus visibility for the tab bar, file-type icons, line numbers, and scrollbar. Point scrollbar width, radius, and spacing at `ui.Theme` instead of the hardcoded 4 / 8 / 8 paint values, so those Zed-style chrome knobs have a place to land.

**Leave out of v1.** Do not port community CSS themes, the themes-folder loader, Manage, or CSS snippets. Their mechanism is vault CSS files and a theme style element, and nothing in the native or attention-ui paint path consumes CSS. Do not port the Advanced group: zoom, native menus, frame style, custom icon, translucency, and hardware acceleration. Do not invent a second color-token format; named schemes stay `"default"` until a real selector writes something other than that into `theme.For`. Ribbon configuration stays out until its options are specified; the port only has a single show/hide switch today.

## Sources
- [S1] "AppearanceSettingTab.ts" — "/home/cc/Projects/attention/apps/web/builtin/AppearanceSettingTab.ts:51-58,64-135,173-282,285-455" (independently checked against "AppearanceSettingTab.ts" — "/home/cc/Projects/attention/apps/web/builtin/AppearanceSettingTab.ts:51-57,64-135,173-415,418-455")
- [S2] "AppearanceManager.ts" — "/home/cc/Projects/attention/apps/web/app/theme/AppearanceManager.ts:68-77,134-157"
- [S3] "AppearanceManager.ts" — "/home/cc/Projects/attention/apps/web/app/theme/AppearanceManager.ts:167-196"
- [S4] "ThemeManager.ts and CustomCss.ts" — "/home/cc/Projects/attention/apps/web/app/theme/ThemeManager.ts:38-77; /home/cc/Projects/attention/apps/web/app/theme/CustomCss.ts:19,122-124,130-142,184-191" (independently checked against "ThemeManager.ts and CustomCss.ts" — "/home/cc/Projects/attention/apps/web/app/theme/ThemeManager.ts:38-77; /home/cc/Projects/attention/apps/web/app/theme/CustomCss.ts:19,122-124,137-142,184-191")
- [S5] "CssSnippetManager.ts and CustomCss.ts" — "/home/cc/Projects/attention/apps/web/app/theme/CssSnippetManager.ts:44-63; /home/cc/Projects/attention/apps/web/app/theme/CustomCss.ts:126-136,144-146,194-216" (independently checked against "CssSnippetManager.ts, CustomCss.ts, AppearanceSettingTab.ts" — "/home/cc/Projects/attention/apps/web/app/theme/CssSnippetManager.ts:44-63; /home/cc/Projects/attention/apps/web/app/theme/CustomCss.ts:126-146,194-216; /home/cc/Projects/attention/apps/web/builtin/AppearanceSettingTab.ts:443-452")
- [S6] "layout.go appearance" — "/home/cc/Projects/attention-p0/native/plugins/layout/layout.go:327-338" (independently checked against "layout.go appearance" — "/home/cc/Projects/attention-p0/native/plugins/layout/layout.go:327-365")
- [S7] "layout.go colorScheme" — "/home/cc/Projects/attention-p0/native/plugins/layout/layout.go:341-353"
- [S8] "layout.go dark" — "/home/cc/Projects/attention-p0/native/plugins/layout/layout.go:132-134,313-325"
- [S9] "layout.go showRibbon" — "/home/cc/Projects/attention-p0/native/plugins/layout/layout.go:231-236,356-365"
- [S10] "layout.go View and themeFor" — "/home/cc/Projects/attention-p0/native/plugins/layout/layout.go:241-255,483-491"
- [S11] "settingsapi.go" — "/home/cc/Projects/attention-p0/native/settingsapi/settingsapi.go:1-6,20-25,34-35,63-77" (independently checked against "settingsapi.go" — "/home/cc/Projects/attention-p0/native/settingsapi/settingsapi.go:1-6,20-35,63-77; /home/cc/Projects/attention-p0/native/internal/persist/persist.go:33-34; /home/cc/Projects/attention-p0/native/internal/paths/paths.go:10-21")
- [S12] "attention-ui applyTheme" — "/home/cc/Projects/attention-ui-pin/attention-ui/ui/style.go" (independently checked against "attention-ui applyTheme" — "/home/cc/Projects/attention-ui-pin/attention-ui/ui/style.go:21-29")
- [S13] "native Appearance section" — "/home/cc/Projects/attention-p0/native/plugins/layout/layout.go" (independently checked against "native Appearance section" — "/home/cc/Projects/attention-p0/native/plugins/layout/layout.go:327-365,483-491")
- [S14] "attention-ui theme.paint" — "/home/cc/Projects/attention-ui-pin/attention-ui/theme/theme.go" (independently checked against "attention-ui theme.paint" — "/home/cc/Projects/attention-ui-pin/attention-ui/theme/theme.go:32-33,277-287,402-438")
- [S15] "mygo ui.Theme" — "/home/cc/go/pkg/mod/github.com/egoist/mygo@v0.7.2-0.20261028073710-642005fd4978/ui/theme.go" (independently checked against "mygo ui.Theme" — "/home/cc/go/pkg/mod/github.com/egoist/mygo@v0.7.2-0.20261028073710-642005fd4978/ui/theme.go:43-56,98-155")
- [S16] "mygo editor.DefaultTheme" — "/home/cc/go/pkg/mod/github.com/egoist/mygo@v0.7.2-0.20261028073710-642005fd4978/ui/editor/theme.go" (independently checked against "mygo editor.DefaultTheme" — "/home/cc/go/pkg/mod/github.com/egoist/mygo@v0.7.2-0.20261028073710-642005fd4978/ui/editor/theme.go:7-46,55-56,135-140")
- [S17] "Appearance" — "https://github.com/zed-industries/zed/blob/main/docs/src/appearance.md"
- [S18] "Appearance" — "https://github.com/zed-industries/zed/blob/main/docs/src/appearance.md" (independently checked against "Appearance" — "https://zed.dev/docs/appearance")
- [S19] "Icon Themes" — "https://github.com/zed-industries/zed/blob/main/docs/src/icon-themes.md"
- [S20] [S21] "Themes" — "https://github.com/zed-industries/zed/blob/main/docs/src/themes.md"
- [S22] "Visual Customization" — "https://github.com/zed-industries/zed/blob/main/docs/src/visual-customization.md" (independently checked against "Visual Customization" — "https://zed.dev/docs/visual-customization")

## Coverage and uncertainty
- "Question 1 uncertainty: The Interface toggle baseFontSizeAction only calls vault.setConfig in AppearanceSettingTab; AppearanceManager.updateFontSize reads baseFontSize only, so this pass did not show that toggle changing --font-text-size."
- "Question 1 uncertainty: ThemeManager.loadDefaultTheme registers obsidian-default-light, but this pass did not confirm its caller, so it is not treated as the cssTheme application path."
- "Question 2 uncertainty: The not-ported list is only what layout.go states; this pass did not diff it against the original TypeScript AppearanceSettingTab."
- "Question 2 uncertainty: theme.For’s second argument is the literal \"default\" in layout.go, but the attention-ui theme package was not read, so what \"default\" selects is not established."
- "Question 3 uncertainty: attention-ui/go.mod requires github.com/egoist/mygo v0.6.4 while native/go.mod selects v0.7.2-0.20261028073710-642005fd4978; the cited Theme fields and DefaultTheme GitHub comment match in both copies, but the files were not fully diffed."
- "Question 3 uncertainty: Many native widgets pass an explicit FontSize, so Theme.FontSize is not shown here to control every label."
- "Question 4 uncertainty: Terminal line_height is given the same comfortable (1.618), standard (1.3), or {\"custom\": number} options, but the Fonts example sets \"standard\" and the Terminal Panel example sets \"comfortable\", so these pages do not state one terminal default the way appearance.md labels buffer_line_height \"comfortable\" as the default."
- "Question 4 uncertainty: The 2024 blog shows experimental.theme_overrides as one object applied to every theme. Current themes.md instead documents theme_overrides keyed by theme name. These docs were not checked against the settings implementation."
- "Question 4 uncertainty: Example values in visual-customization.md, such as project_panel.dock \"right\" and tabs.file_icons false, are not labeled as defaults, so they were not treated as the shipped defaults. Icon-theme extension JSON (schema v0.3.0) was read only as the authoring format, not as the user icon_theme setting."
- "Claim claim-3 was excluded by verification: appearance-change is emitted with current settings from base theme, accent, fonts, font size, and setCssSnippetsEnabled, and the base-theme/obsidian/moonstone/system behavior matches, but css-change \"accent-color\", \"font-family\", or \"font-size\" is not emitted for those updates: setCssSnippetsEnabled emits no css-change, and base theme emits \"base-theme\" only when the theme class changes.."
- "Claim claim-12 was excluded by verification: Unknown schemes do fall back to default, but the scheme also changes AccentText, so it is not only the accent triple.."
