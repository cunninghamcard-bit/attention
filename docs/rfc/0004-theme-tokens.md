# RFC 0004：主题分层与 token

- 状态：草案
- 日期：2026-11-03
- 代码：`native/plugins/appearance`、`native/ui`
- 取代：[docs/appearance.md](../appearance.md) 的「主题里有什么」「其余颜色怎么来」「Zed 主题」三节

## 1. 现状的问题

现在的主题只有 9 个界面色、9 个语法色和可选的 16 个终端色，其余颜色全部由代码推导。实测：

- `native/ui` 和 `plugins/` 里有 59 处颜色是在调用处临时算出来的，不在主题里：
  - `Wash(t, a)`（文字色加透明度）用了 9 种透明度：0.04、0.05、0.06、0.07、0.08、0.09、0.1、0.12、0.14。同样是「悬停」，标签行用 0.06，地址栏用 0.09，菜单项用 0.07。
  - `Shade(a)`（黑色加透明度）用了 8 种：0.06、0.08、0.12、0.16、0.18、0.25、0.28、0.32。
  - `Raised(t)` 在代码里按亮暗分叉：亮色主题取 `Background`，暗色主题取 `Surface` 往 `Text` 混 12%。
  - 强调色的浅底各处不同：拖放目标 0.12、列表选中 0.16、卡片聚焦边框 0.5、拖放边框 0.6。
- 主题作者改不了这些值。一个主题想让悬停更明显、阴影更重、选中行换颜色，都做不到。
- Zed 主题文件只读约 20 个键，映射到 9 个界面色上，Zed 的界面键和编辑器键混在一起丢掉了大部分。
- 编辑器有 25 种 token（`editor.TokenKind`），主题只能写 9 种，而且不能写粗体和斜体。

TS 版 attention 沿用 Obsidian 的 CSS 变量，分三层：基础色板（`--color-base-00…100`、`--color-red` 等）→ 语义色（`--background-primary`、`--text-muted`、`--background-modifier-hover`、`--interactive-accent` 等）→ 组件变量（`--tab-*`、`--nav-*` 等），共约 840 个。主题只覆盖其中一部分，其余由上一层推出。本 RFC 借用这个**分层结构**，不借用它的变量名和数量：名字和条目按 `native/ui` 实际要画的东西定。

## 2. 目标和不做

目标：

1. 界面颜色分三层：色板、语义 token、组件 token。组件只读语义 token 或组件 token，不再在调用处临时调透明度。
2. 主题文件写色板，可以覆盖任意语义 token 和组件 token。
3. 编辑器和终端的配色用 Zed 的键名和结构，可以直接读 Zed 主题文件的这一部分。
4. 界面部分不用 Zed 的键名，也不从 Zed 主题文件推导界面颜色。

不做：

- CSS、Obsidian 社区主题、CSS 片段（RFC 0001 §5.12 已定）。
- Zed 的 `accents`、`theme_overrides`、界面键（`panel.*`、`tab_bar.*` 等）、图标主题。
- 字体、字号、间距、圆角仍是设置，不进主题。
- 旧主题格式不兼容，内置主题直接改写成新格式（项目没有用户，见 RFC 0003 §8）。

## 3. 第一层：色板

每个主题写一套，亮暗各自独立。

| 键 | 含义 |
|---|---|
| `neutral.0` … `neutral.100` | 中性色阶，11 级：0、5、10、20、30、40、50、60、70、80、100。0 是页面底色，100 是正文色；暗色主题里 0 最暗 |
| `red`、`orange`、`yellow`、`green`、`cyan`、`blue`、`purple`、`pink` | 8 个彩色 |
| `accent` | 强调色，写 `#rrggbb` 或 `{ "h": 258, "s": 88, "l": 66 }` |

强调色的变体按 HSL 推导，规则取自 TS 版的 `--color-accent-1/2`：

| 变体 | 亮色主题 | 暗色主题 |
|---|---|---|
| `accent.1`（按钮底色） | h−1，s×1.01，l×1.075 | h−3，s×1.02，l×1.15 |
| `accent.2`（悬停） | h−3，s×1.02，l×1.15 | h−5，s×1.05，l×1.29 |

设置里的 `accentColor` 替换主题的 `accent`，变体照样推导。现在的四个预设方案（`ocean`、`forest`、`rose`、`amber`）删除。

## 4. 第二层：语义 token

主题可以覆盖任何一个；没写的取下表的默认值。默认值里 `a@x` 表示颜色 a 的透明度取 x。

| token | 用途 | 默认值 |
|---|---|---|
| **底色** | | |
| `bg.window` | 窗口底色，侧栏和上下文栏的底（再叠项目颜色） | `neutral.10` |
| `bg.page` | 内容卡片 | `neutral.0` |
| `bg.raised` | 侧栏里选中的标签行、设置分组 | 亮：`neutral.0`；暗：`neutral.20` |
| `bg.overlay` | 菜单、弹出层、Omnibox | 亮：`neutral.0`；暗：`neutral.10` |
| `bg.field` | 输入框、下拉框 | `neutral.100@0.05` |
| `bg.inverse` | 提示、toast | `neutral.100` |
| **文字** | | |
| `text.primary` | 正文 | `neutral.100` |
| `text.secondary` | 次要文字、图标 | `neutral.70` |
| `text.tertiary` | 占位、禁用 | `neutral.50` |
| `text.onAccent` | 强调色底上的字 | 按 `accent.1` 亮度取黑或白 |
| `text.inverse` | `bg.inverse` 上的字 | `neutral.0` |
| `text.link` | 链接 | `accent` |
| **边框** | | |
| `border.subtle` | 分隔线、卡片暗色描边 | `neutral.100@0.08` |
| `border.default` | 控件边框 | `neutral.30` |
| `border.strong` | 悬停时的边框 | `neutral.40` |
| `border.focus` | 键盘焦点环 | `accent@0.35` |
| **状态**（叠在任何底色上） | | |
| `fill.hover` | 悬停 | `neutral.100@0.06` |
| `fill.pressed` | 按下 | `neutral.100@0.10` |
| `fill.selected` | 列表里选中但未聚焦 | `neutral.100@0.08` |
| `fill.accent` | 强调色浅底：选中的设置项、拖放目标 | `accent@0.14` |
| **强调** | | |
| `accent.fill` | 主按钮、开关、勾选 | `accent.1` |
| `accent.fillHover` | 主按钮悬停 | `accent.2` |
| `accent.border` | 拖放目标的边、聚焦卡片的边 | `accent@0.55` |
| **状态色** | | |
| `status.error`、`status.warning`、`status.success`、`status.info` | 文字和图标 | `red`、`orange`、`green`、`blue` |
| `status.errorFill` | 危险按钮底色 | `red` |
| **其他** | | |
| `selection` | 选中的文字 | `accent@0.25` |
| `highlight` | 搜索命中、`==标记==` | `yellow@0.4` |
| `scrollbar` | 滚动条 | `neutral.100@0.25` |
| `scrim` | 模态框背后的遮罩 | `#000@0.32` |
| `shadow.small` | 选中的标签行、设置分组 | `0 1 2 #000@0.08` |
| `shadow.medium` | 卡片、玻璃面板 | `0 8 24 #000@0.16` |
| `shadow.large` | 模态框、菜单 | `0 24 64 #000@0.28` |

阴影 token 写成 `x y blur color`，因为 `ui.Element.Shadow` 要这四个值。

## 5. 第三层：组件 token

只给真正和语义 token 不同的组件开，默认值都引用第二层。主题可以覆盖。

| token | 默认值 |
|---|---|
| `tabRow.selected`、`tabRow.selectedShadow`、`tabRow.hover` | `bg.raised`、`shadow.small`、`fill.hover` |
| `splitRow.selected`、`splitRow.hover` | `fill.selected`、`fill.hover@0.66` |
| `addressBar.bg`、`addressBar.hover` | `fill.hover`、`fill.pressed` |
| `card.border`（只在暗色主题画） | `border.subtle` |
| `button.secondary`、`.hover`、`.pressed` | `fill.hover`、`fill.pressed`、`neutral.100@0.14` |
| `menu.itemHover` | `fill.hover` |
| `glass.bg` | `bg.raised@0.78` |

## 6. 编辑器和终端：Zed 的键

主题文件的 `editor` 部分直接用 Zed themes v0.2.0 的键名，读法和 Zed 一致。也可以把 Zed 的主题文件放进主题目录，**只取这一部分**，作为单独的「编辑器配色」选择。

| `editor.Theme` 字段 | Zed 键 |
|---|---|
| `Background`、`Text` | `editor.background`、`editor.foreground` |
| `LineNumber`、`ActiveLineNumber` | `editor.line_number`、`editor.active_line_number` |
| `ActiveLine` | `editor.active_line.background` |
| `Selection`、`Cursor` | `players[0].selection`、`players[0].cursor` |
| `InactiveSelection` | `players[0].selection` 透明度减半 |
| `MatchingBracket` | `editor.document_highlight.bracket_background` |
| `Match`、`CurrentMatch` | `search.match_background`；当前项取它透明度加倍 |
| `Occurrence` | `editor.document_highlight.read_background` |
| `IndentGuide`、`ActiveIndentGuide` | `editor.indent_guide`、`editor.indent_guide_active` |
| `WrapGuide`、`Whitespace` | `editor.wrap_guide`、`editor.invisible` |
| `Error`、`Warning`、`Info`、`Hint` | `error`、`warning`、`info`、`hint` |
| `Added`、`Deleted`、`Modified` | `created`、`deleted`、`modified` |

`syntax` 用 Zed 的结构（`color`、`font_style`、`font_weight`），25 种 token 对应如下，冒号后是找不到时的退路：

| TokenKind | Zed `syntax` 键 |
|---|---|
| Text | `editor.foreground` |
| Keyword、Type、Function、Variable、Property | `keyword`、`type`、`function`、`variable`、`property` |
| Constant、Number | `constant`：`boolean`；`number` |
| String、Escape、Regexp | `string`；`string.escape`：`string.special`；`string.regex` |
| Comment、Operator、Punctuation | `comment`；`operator`；`punctuation` |
| Tag、Attribute、Meta | `tag`；`attribute`；`preproc`：`attribute` |
| Heading、Emphasis、Strong | `title`；`emphasis`；`emphasis.strong` |
| Link、Code | `link_text`：`link_uri`；`text.literal` |
| Inserted、Deleted、Invalid | `created`；`deleted`；`error` |

终端用 `terminal.background`、`terminal.foreground`、`terminal.ansi.*` 和 `terminal.ansi.bright_*`。

编辑器部分没写的键，从界面的语义 token 推：背景 `bg.page`，正文 `text.primary`，行号 `text.tertiary`，选区 `selection`，诊断取 `status.*`。

Markdown 阅读视图的颜色来自两边：正文、引用、表格、分隔线取界面语义 token；代码块取编辑器配色。

## 7. 主题文件

```json
{
  "name": "Attention",
  "themes": [
    {
      "name": "Attention Light",
      "appearance": "light",
      "palette": {
        "neutral.0": "#ffffff", "neutral.5": "#fcfcfc", "…": "…", "neutral.100": "#222222",
        "red": "#e93147", "…": "…",
        "accent": { "h": 258, "s": 88, "l": 66 }
      },
      "tokens": { "fill.hover": "neutral.100@0.05" },
      "components": { "addressBar.bg": "fill.selected" },
      "editor": {
        "editor.active_line.background": "#0000000a",
        "syntax": { "keyword": { "color": "#d32a61", "font_weight": 600 } }
      },
      "terminal": { "terminal.ansi.red": "#c44f4a" }
    }
  ]
}
```

- `tokens` 和 `components` 的值可以写颜色，也可以写别的 token 名，后面可跟 `@透明度`。
- `editor` 和 `terminal` 两部分的键与 Zed 主题的 `style` 里同名的键一一对应。
- 主题目录里的 Zed 主题文件只当编辑器配色读，不出现在界面主题的列表里。

## 8. token 怎样传到组件

mygo 的 `c.Theme()` 返回固定字段的 `*ui.Theme`，`SetTheme` 对之后创建的子树生效，没有别的按作用域传值的办法。两个方案：

| | A：按 `*ui.Theme` 指针登记 | B：组件参数里显式传 `*Tokens` |
|---|---|---|
| 做法 | `appearance` 每建一套主题，把 `*ui.Theme` 和对应的 `*aui.Tokens` 一起登记到 `native/ui`；组件用 `aui.Tokens(c)` 按 `c.Theme()` 查 | 每个组件的 Props 加一个 `Tokens` 字段，调用方一路传下去 |
| 亮暗嵌套（亮色窗口里的暗色终端） | 能用：子树 `SetTheme` 换了指针，查到的就是那一套 | 能用，但每个调用点都要拿对 |
| 改动面 | 只改 `native/ui` 和 `appearance` | 所有画界面的插件都要改 |
| 没登记的主题（测试、示例） | 从 `*ui.Theme` 推一套默认 token | 调用方必须给 |

选 A。`*ui.Theme` 变成 token 的投影：`Background` = `bg.page`，`Surface` = `bg.field`，`Border` = `border.default`，`Text` = `text.primary`，`TextMuted` = `text.secondary`，`Accent` = `accent.fill`，`AccentHover` = `accent.fillHover`，`AccentText` = `text.onAccent`，`Selection` = `selection`，`Focus` = `border.focus`，`Inverse` = `bg.inverse`，`Scrollbar` = `scrollbar`。mygo 自己的控件（`TextInput`、`Scroll` 等）只看到这些字段，照常工作。

登记表只在主线程读写。每帧的开销是一次 map 查找。

## 9. 现有颜色的去处

| 现在 | 改成 |
|---|---|
| `Wash(t, 0.04/0.05/0.06/0.07/0.09)` 用作悬停 | `fill.hover` 或对应组件 token |
| `Wash(t, 0.08/0.1/0.12/0.14)` 用作按下、选中 | `fill.pressed`、`fill.selected`、`button.secondary.pressed` |
| `Wash(t, 0.06/0.08/0.1)` 用作分隔线、描边 | `border.subtle` |
| `Raised(t)` | `bg.raised` |
| `Shade(0.06/0.08)` + 偏移 | `shadow.small` |
| `Shade(0.12/0.16/0.18)` + 偏移 | `shadow.medium` |
| `Shade(0.28)`、`Shade(0.25/0.32)` | `shadow.large`、`scrim` |
| `t.Accent.Alpha(0.12/0.16)` | `fill.accent` |
| `t.Accent.Alpha(0.5/0.6)` | `accent.border` |
| `t.Danger.Mix(t.Text, …)`、`ui.Hex("#ffffff")` | `status.errorFill`，字取 `text.onAccent` |
| `layout.go` 的项目底色 `t.Surface.Mix(col, amount)` | `bg.window` 混项目颜色，比例不变 |

`Wash`、`Shade`、`Raised` 三个函数删除。

## 10. 设置项

- 保留：`theme`（`system`、`light`、`dark`）、`lightTheme`、`darkTheme`、`accentColor`、`iconTheme`。
- 新增：`editorTheme`：空表示跟随界面主题，否则是一个编辑器配色的名字（来自我们的主题或 Zed 主题文件）。
- 删除：`accent`（四个预设方案）。

## 11. 内置主题

- `Attention Light`、`Attention Dark`：改写成新格式，写全色板。
- `One`、`Ayu`：改成 Zed 原样的主题文件，只作编辑器配色。

## 12. 分步实施

每一步单独提交，都过 gofmt、vet、测试、asl 和 CLI 端到端测试，再截图核对。

1. `native/ui` 加 `Tokens` 类型、登记表、`aui.Tokens(c)` 和从 `*ui.Theme` 推默认 token 的函数；组件换成读 token，删掉 `Wash`、`Shade`、`Raised`。界面颜色和现在一致。
2. `appearance` 读新主题格式（色板、`tokens`、`components`），建 token 和 `*ui.Theme` 投影，登记；改写 `Attention Light/Dark`；删除 `accent` 预设。
3. 编辑器和终端部分按 §6 读 Zed 键；Zed 主题文件作为编辑器配色；加 `editorTheme` 设置；`One`、`Ayu` 换成 Zed 原文件。
4. 改 `docs/appearance.md`。

## 13. 待定

1. 终端算不算「编辑器部分」：本 RFC 按算处理，用 Zed 的 `terminal.*` 键。不算的话，终端颜色改成从色板的 8 个彩色推。
2. 设置页要不要提供 token 覆盖的编辑界面：本 RFC 不做，只能写主题文件。
