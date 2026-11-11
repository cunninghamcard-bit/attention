# 外观系统

- 更新：2026-11-11
- 代码：`native/plugins/appearance`（主题和设置）、`native/ui/tokens.go`（组件读的 token）
- 设计：[RFC 0004](rfc/0004-theme-tokens.md)，讨论在 attention#11
- 原版设置页是 `apps/web/builtin/AppearanceSettingTab.ts`，应用是 `apps/web/app/theme/AppearanceManager.ts`。

## 主题

只有一种格式：NvChad 的 base46。一个主题同时决定界面、编辑器、Markdown 里的代码和终端的颜色。

- **内置**：base46 v3.0 的 98 个（亮 21、暗 77），在 `native/plugins/appearance/themes/base46/`，由 `scripts/base46-themes.lua` 转换，许可证在同目录。
- **用户主题**：`<配置目录>/themes/*.json`，格式和内置的一样（`name`、`type`、`base_30`、`base_16`）。设置页 Themes folder 一行可以打开和重新读取这个目录，读不了的文件和缺键的主题在那一行列出原因。
- **默认**：亮色 `one_light`，暗色 `onedark`。

`base_30` 和 `base_16` 怎么对应到界面、编辑器和终端，见 RFC 0004 §3、§4。

## 设置

`appearance.json` 里的键：

- 主题：`theme`（`system`、`light`、`dark`）、`lightTheme`、`darkTheme`（base46 主题名）、`iconTheme`。
- 密度：`density`（`compact` 默认、`comfortable`、`spacious`），同时调行和控件的高度、间距单位、阅读视图的行高（RFC 0004 §5）。
- 字体：`interfaceFontFamily`、`textFontFamily`、`monospaceFontFamily`、`baseFontSize`、`editorFontSize`。字体由用户自己选，不打包。
- 编辑器：`lineHeight`（`comfortable` 即 Zed 的 1.618、`standard` 1.3、`custom` 加 `customLineHeight`）、`tabSize`、`italicComments`、`showLineNumbers`、`showIndentGuides`。
- 界面：`showInlineTitle`、`showFileIcons`、`radius`、`scrollbarWidth`。

## 代码结构

```
appearance.Appearance（主线程）
① refresh：settings.Generation() 变了才重新解析 appearance.json
② of(dark)：设置或主题文件变了才重建，亮暗各缓存一份
   ├ catalog.theme(name, dark)：按名字取主题，取不到用默认的
   ├ tokens(theme, density)：base_30 → *aui.Tokens（RFC 0004 §3）
   ├ project：*ui.Theme 取 token 里它有字段的那些，Spacing 取密度
   ├ acardOf：ACard 组件的 token，控件高度取密度
   ├ aui.Register / acard.Register：组件用 aui.TokensOf(c)、tokens.TokensOf(c) 按 c.Theme() 查到这一套
   └ buildEditor / buildMarkdown / buildTerminal：base_16 和 base_30（RFC 0004 §4）
③ 读取方
   ├ layout.View（每帧）：c.SetTheme(app.UI())，窗口底色是 BgWindow
   ├ native/ui 的组件：aui.TokensOf(c)，行高加 RowStep
   ├ text-ui、markdown-ui、chat：app.Editor(dark)、app.Markdown(dark)、app.Settings()
   ├ terminal-ui：app.Generation() 变了才 term.SetTheme(app.Terminal(false), app.Terminal(true))
   └ workspace、filetree、search、bookmarks、backlinks、switcher：app.Settings() 的开关，app.Icons() 的文件图标
```

没登记的 `*ui.Theme`（测试、示例）由 `aui.DerivedTokens` 从它的字段推一套 token。

## 不做

- 社区 CSS 主题、CSS 片段。
- 其他主题格式（Zed、VS Code、自定色板）。
- 在设置页里编辑颜色。
- 缩放、原生菜单、窗口边框、半透明。

## 调研

- [Zed 的外观](research/appearance-zed.md)
- [原版 Appearance 和原生缺口](research/appearance-original.md)
- [Kero 2.1.25–2.1.31 的界面](research/appearance-kero.md)
