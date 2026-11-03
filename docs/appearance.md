# 外观系统

- 更新：2026-11-03
- 代码：`native/plugins/appearance`（主题和设置）、`native/ui/tokens.go`（组件读的 token）
- 设计：[RFC 0004](rfc/0004-theme-tokens.md)
- 原版设置页是 `apps/web/builtin/AppearanceSettingTab.ts`，应用是 `apps/web/app/theme/AppearanceManager.ts`。

## 主题分两半

| 部分 | 管什么 | 格式 |
|---|---|---|
| 界面主题 | 窗口、侧栏、卡片、控件、Markdown 阅读视图的颜色 | 我们自己的：色板 + token（下文） |
| 编辑器配色 | 代码编辑器和终端 | Zed themes v0.2.0 的键 |

字体、字号、间距、圆角是设置，不进主题。

## 界面主题

三层，每层只引用上一层（RFC 0004 §3–§5）：

1. **色板**（`palette`，必须写全）：`neutral.0` … `neutral.100` 共 11 级（0、5、10、20、30、40、50、60、70、80、100；0 是页面底色，100 是正文色），8 个彩色 `red`、`orange`、`yellow`、`green`、`cyan`、`blue`、`purple`、`pink`，强调色 `accent`（`#rrggbb` 或 `{ "h": 258, "s": 88, "l": 66 }`）。强调色另外推出 `accent.1`（按钮底色）和 `accent.2`（悬停），规则取自 TS 版的 `--color-accent-1/2`；`onAccent` 按 `accent.1` 的亮度取黑字或白字。
2. **语义 token**（`tokens`，可选）：约 35 个，默认值见 `plugins/appearance/tokens.go` 的 `semanticDefaults`，也就是 RFC 0004 §4 的表。
3. **组件 token**（`components`，可选）：标签行、地址栏、按钮、菜单、玻璃面板这些和语义 token 不同的地方，默认值由 `aui.ComponentTokens` 从语义 token 算出。

`tokens` 和 `components` 的值写颜色 `#rrggbb[aa]`、色板名或别的 token 名，后面可跟 `@透明度`，如 `neutral.100@0.06`；阴影写 `x y blur 颜色`。写错的项在设置页 Themes folder 一行列出，用默认值。

```json
{
  "name": "Attention",
  "themes": [
    {
      "name": "Attention Light",
      "appearance": "light",
      "palette": { "neutral.0": "#ffffff", "…": "…", "accent": "#181818" },
      "tokens": { "text.link": "blue" },
      "components": { "addressBar.bg": "fill.selected" },
      "editor": { "syntax": { "keyword": { "color": "#d32a61" } } },
      "terminal": { "terminal.ansi.red": "#c44f4a" }
    }
  ]
}
```

## 编辑器配色

- 我们的主题里 `editor` 和 `terminal` 两部分，键与 Zed 主题 `style` 里同名的键相同；`syntax` 的每项有 `color`、`font_style`、`font_weight`（600 及以上算粗体）。
- 主题目录里的 Zed 主题文件（有 `style` 的）只当编辑器配色读，不出现在界面主题列表里。
- 设置 `editorTheme` 选一个家族（文件的 `name`，如 `One`），按当前亮暗取其中对应的那个；空表示跟随界面主题自己的 `editor` 部分；都没有时从界面 token 推。
- 读哪些键、25 种 token 怎么对应，见 RFC 0004 §6。

## 主题从哪里来

- 内置：`native/plugins/appearance/themes/attention.json`（`Attention Light/Dark`）；`themes/zed/` 下是 Zed 原样的 One 和 Ayu（MIT，许可证在同目录），只作编辑器配色。
- 用户：`<配置目录>/themes/*.json`，设置页的 Themes folder 一行可以打开和重新读取，读不了的文件和写错的 token 在那一行列出原因。

## 设置

`appearance.json` 里的键：

- 主题：`theme`（`system`、`light`、`dark`）、`lightTheme`、`darkTheme`、`editorTheme`、`accentColor`（替换主题的 `accent`，变体照样推导）、`iconTheme`。
- 字体：`interfaceFontFamily`、`textFontFamily`、`monospaceFontFamily`、`baseFontSize`、`editorFontSize`。
- 编辑器：`lineHeight`（`comfortable`、`standard`、`custom` 加 `customLineHeight`）、`tabSize`、`italicComments`、`showLineNumbers`、`showIndentGuides`。
- 界面：`showInlineTitle`、`showFileIcons`、`treeDensity`、`spacing`、`radius`、`scrollbarWidth`。

## 代码结构

```
appearance.Appearance（主线程）
① refresh：settings.Generation() 变了才重新解析 appearance.json
② of(dark)：设置或主题文件变了才重建，亮暗各缓存一份
   ├ tokens(theme, accentColor)：色板 → 语义 token → 组件 token，得到 *aui.Tokens
   ├ project：*ui.Theme 取 token 里它有字段的那些（Surface = bg.window，Background = bg.page …）
   ├ aui.Register(ui, tokens)：组件用 aui.TokensOf(c) 按 c.Theme() 查到这一套
   └ editor / markdown / terminal：编辑器配色的 Zed 键，缺的从 token 推
③ 读取方
   ├ layout.View（每帧）：c.SetTheme(app.UI())；侧栏用的染了项目色的副本连同 token 一起登记
   ├ native/ui 的组件：aui.TokensOf(c)
   ├ text-ui、markdown-ui：app.Editor(dark)、app.Markdown(dark)、app.Settings()
   ├ terminal-ui：app.Generation() 变了才 term.SetTheme(app.Terminal(false), app.Terminal(true))
   └ workspace、filetree、search、bookmarks、backlinks、switcher：app.Settings() 的开关，app.Icons() 的文件图标
```

没登记的 `*ui.Theme`（测试、示例）由 `aui.DerivedTokens` 从它的字段推一套 token。

## 不做

- 社区 CSS 主题、主题目录、CSS 片段。
- Zed 的 `accents`、`theme_overrides`、界面键、图标主题。
- 在设置页里编辑 token。
- 缩放、原生菜单、窗口边框、半透明。

## 调研

- [Zed 的外观](research/appearance-zed.md)
- [原版 Appearance 和原生缺口](research/appearance-original.md)
- [Kero 2.1.25–2.1.31 的界面](research/appearance-kero.md)
