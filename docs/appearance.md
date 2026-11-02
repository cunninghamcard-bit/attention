# 外观系统

- 更新：2026-11-02
- 代码：`native/plugins/appearance`
- 原版设置页是 `apps/web/builtin/AppearanceSettingTab.ts`，应用是 `apps/web/app/theme/AppearanceManager.ts`。

## 主题里有什么

一个主题只有颜色，分三组。字体、字号、间距、圆角是设置，不进主题。

| 组 | 内容 | 必填 |
|---|---|---|
| `colors` | `background`、`surface`、`border`、`text`、`textMuted`、`accent`、`danger`、`warning`、`success` | 九个都要写 |
| `syntax` | `comment`、`keyword`、`string`、`number`、`function`、`type`、`variable`、`punctuation`、`tag` | 可选，缺的键用编辑器默认色 |
| `terminal` | ANSI 0–15，16 个 | 可选，缺了用 mygo 终端的默认色 |

颜色写 `#rgb`、`#rrggbb` 或 `#rrggbbaa`。

```json
{
  "name": "One",
  "themes": [
    {
      "name": "One Dark",
      "appearance": "dark",
      "colors": { "background": "#282c33", "surface": "#2f343e", "border": "#363c46", "text": "#dce0e5", "textMuted": "#a9afbc", "accent": "#74ade8", "danger": "#d07277", "warning": "#dec184", "success": "#a1c181" },
      "syntax": { "comment": "#5d636f", "keyword": "#b477cf", "string": "#a1c181" }
    }
  ]
}
```

## 其余颜色怎么来

全部由上面的颜色算出，代码在 `build.go`：

- 界面（`ui.Theme`）：hover、pressed 是 `surface` 往 `text` 混 6% 和 12%；accentHover、accentPressed 是 `accent` 调亮、调暗；accentText 按 `accent` 的亮度取黑字或白字；focus 是 `accent` 35% 透明；选区是 `accent` 25% 透明；滚动条用 `border`。`native/ui` 的组件只读 `ui.Theme`，所以换主题时整个界面一起变。
- 编辑器（`editor.Theme`）：从 `editor.DefaultTheme(ui 主题)` 起，诊断和 diff 颜色用 `danger`、`warning`、`success`，标题用 `text`，链接用 `accent`，`syntax` 的九个颜色覆盖对应的词法类别。
- Markdown 阅读视图：从界面和编辑器主题取色，字体和字号来自设置。
- 终端：前景、背景取 `text`、`background`，16 色取 `terminal`。

## Zed 主题

主题目录里也可以直接放 Zed 的主题文件（themes v0.2.0 的 family 格式）。读取时只取大约 20 个键，映射到上面三组；Zed 的其余键一律忽略，`theme_overrides`、`accents`、图标主题包都不支持。

| 我们的 | Zed 的键（取第一个有值的） |
|---|---|
| `background` | `editor.background`、`background` |
| `surface` | `panel.background`、`surface.background`、`elevated_surface.background` |
| `border` | `border.variant`、`border` |
| `text` | `text`、`editor.foreground` |
| `textMuted` | `text.muted`、`text.placeholder` |
| `accent` | `text.accent`、`border.focused` |
| `danger`、`warning`、`success` | `error`、`warning`、`success`，再退到 `version_control.*` |
| `syntax.*` | 同名的 `syntax` 键；`number` 退到 `constant`，`variable` 退到 `property`，`punctuation` 退到 `operator` |
| `terminal` | `terminal.ansi.*` 和 `terminal.ansi.bright_*`，16 个齐全才取 |

## 主题从哪里来

- 内置：`native/plugins/appearance/themes/`：`Attention Light/Dark`（原 attention-ui 的配色）、One 和 Ayu。
- 用户：`<配置目录>/themes/*.json`，设置页的 Themes folder 一行可以打开和重新读取，读不了的文件在那一行列出原因。

## 设置

`appearance.json` 里的键：

- 主题：`theme`（`system`、`moonstone`、`obsidian`）、`lightTheme`、`darkTheme`、`accent`（`default` 用主题的强调色，另有 `ocean`、`forest`、`rose`、`amber` 四种预设）、`accentColor`（自定义强调色，优先于主题和方案）、`iconTheme`。
- 字体：`interfaceFontFamily`、`textFontFamily`、`monospaceFontFamily`、`baseFontSize`、`editorFontSize`。
- 编辑器：`lineHeight`（`comfortable`、`standard`、`custom` 加 `customLineHeight`）、`tabSize`、`italicComments`、`showLineNumbers`、`showIndentGuides`。
- 界面：`showRibbon`、`showViewHeader`、`showInlineTitle`、`showTabBar`、`showFileIcons`、`treeDensity`、`spacing`、`radius`、`scrollbarWidth`。

## 代码结构

`appearance` 插件提供 `*appearance.Appearance`，只在主线程上用：

```
appearance.Appearance
① refresh：settings.Generation() 变了才重新解析 appearance.json
② of(dark)：设置或主题文件变了才重建 ui / editor / markdown / terminal 四个主题，亮暗各缓存一份
③ 读取方
   ├ layout.View（根视图，每帧）：c.SetTheme(app.UI())
   ├ text-ui、markdown-ui：app.Editor(dark)、app.Markdown(dark)、app.Settings()
   ├ terminal-ui：app.Generation() 变了才 term.SetTheme(app.Terminal(false), app.Terminal(true))
   └ workspace、filetree、search、bookmarks、backlinks、switcher：app.Settings() 的开关，app.Icons() 的文件图标
```

除了 `appearance` 插件，没有别的包保存主题状态。

## 不做

- 社区 CSS 主题、主题目录、CSS 片段。
- 缩放、原生菜单、窗口边框、半透明。
- 主题的预览后确认、图标主题分亮暗，这两项还没做。

## 调研

- [Zed 的外观](research/appearance-zed.md)
- [原版 Appearance 和原生缺口](research/appearance-original.md)
- [Kero 2.1.25–2.1.31 的界面](research/appearance-kero.md)
