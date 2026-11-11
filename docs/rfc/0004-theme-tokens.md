# RFC 0004：base46 主题与 token

- 状态：已实施（2026-11-11）。取代 2026-11-03 的版本（自定色板加 Zed 编辑器主题）。
- 讨论：attention#11
- 代码：`native/plugins/appearance`、`native/ui/tokens.go`
- 使用说明：[docs/appearance.md](../appearance.md)

## 1. 为什么改

11-03 的版本有三个问题：

1. 默认主题 Attention Light / Dark 是自己定的一套色板（11 级灰阶加 9 色），再用 36 条默认规则推出界面颜色。编辑器配色也跟着它，所以编辑器不像 One Light。
2. 界面没有设计，只有一组灰阶加黑色强调色。
3. 界面颜色来自自定色板，编辑器颜色来自 Zed 主题文件，两套规则互相覆盖。

#11 定了四条：

1. 主题只有一种格式：NvChad 的 base46。编辑器的颜色也从同一份主题里取。
2. 只有一个主题选项，界面和编辑器一起换；明暗跟随系统时，亮色、暗色各选一套。
3. base46 的 98 个主题全部内置。
4. 加密度设置，三档：紧凑（默认）、舒适、宽松。

## 2. 主题文件

```json
{
  "name": "one_light",
  "type": "light",
  "base_30": { "white": "#54555b", "black": "#fafafa", "…": "…" },
  "base_16": { "base00": "#fafafa", "…": "…", "base0F": "#986801" }
}
```

- **内置**：`native/plugins/appearance/themes/base46/` 下 98 个（亮 21、暗 77），由 `scripts/base46-themes.lua` 从 base46 的 v3.0 分支（d870ec8）转换，许可证在同目录 `LICENSE`。转换脚本在空环境里执行主题的 Lua 文件，只提供 `base46.override_theme`（原样返回）和 NvChad 默认的 `nvconfig`，丢掉 `polish_hl`。
- **用户主题**：`<配置目录>/themes/*.json`，格式相同；和内置主题同名时用户的生效。
- **必须有的键**：`base_16` 的 16 个，`base_30` 里用到的 16 个：`white`、`darker_black`、`black`、`black2`、`one_bg`、`one_bg2`、`one_bg3`、`grey`、`grey_fg`、`grey_fg2`、`line`、`red`、`green`、`yellow`、`blue`、`purple`。缺一个这个主题就不加载，原因列在设置页 Themes folder 一行。
- **命名**：base46 在亮色主题里 `white` 是文字色、`black` 是底色，名字和颜色是反的。

## 3. 界面：`base_30` 到 token

token 是 `native/ui/tokens.go` 的 `aui.Tokens`，组件用 `aui.TokensOf(c)` 读。下表是每个字段的来源。`x@a` 表示颜色 x 的透明度乘 a。

| token | 用途 | 亮色主题 | 暗色主题 |
|---|---|---|---|
| `BgWindow` | 窗口、侧栏、上下文栏 | `black` | `darker_black` |
| `BgPage` | 内容卡片、编辑器、终端 | `black` | `black` |
| `BgRaised` | 设置分组 | `black` | `one_bg` |
| `BgOverlay` | 菜单、弹层、对话框 | `black` | `black2` |
| `BgField` | 输入框、下拉框 | `darker_black` | `one_bg2` |
| `BgInverse` | 提示、toast | `white` | `white` |
| `Text` | 正文 | `white` | `white` |
| `TextSecondary` | 次要文字、图标 | `grey_fg2` | `white@0.6` |
| `TextTertiary` | 占位、禁用 | `grey_fg` | `grey_fg` |
| `TextOnAccent` | 强调色底上的字 | `black` | `black` |
| `TextInverse` | `BgInverse` 上的字 | `black` | `black` |
| `TextLink` | 链接 | `blue` | `blue` |
| `Border`、`BorderStrong` | 边框 | `white@0.125` | `grey` |
| `BorderSubtle` | 分隔线、卡片描边 | `white@0.075` | `grey@0.6` |
| `BorderFocus` | 焦点环 | `blue@0.25` | `blue@0.25` |
| `FillHover` | 悬停 | `darker_black@0.5` | `one_bg3@0.5` |
| `FillPressed` | 按下 | `darker_black` | `one_bg3` |
| `FillSelected`、`FillAccent` | 列表选中、强调色浅底 | `blue@0.1` | `blue@0.1` |
| `AccentFill` | 主按钮、开关 | `blue` | `blue` |
| `AccentFillHover`、`AccentFillPressed` | 主按钮悬停、按下 | `blue@0.9`、`blue@0.8` | 同左 |
| `AccentBorder` | 拖放目标的边 | `blue@0.55` | `blue@0.55` |
| `Error`、`ErrorFill` | 错误 | `red` | `red` |
| `Warning` | 警告 | `yellow` | `yellow` |
| `Success` | 成功 | `green` | `green` |
| `Info` | 信息 | `blue` | `blue` |
| `Selection` | 输入框里选中的文字 | `blue@0.25` | `blue@0.25` |
| `Highlight` | Markdown 的 `==标记==` | `yellow@0.4` | `yellow@0.4` |
| `Scrollbar` | 滚动条 | `white@0.25` | `white@0.25` |
| `Scrim` | 对话框下的遮罩 | 黑色 0.32 | 同左 |
| `ShadowSmall` / `Medium` / `Large` | 阴影 | `0 1 2`、`0 12 32`、`0 24 64`，黑色 0.08 / 0.18 / 0.28 | 同左 |
| `TabRowSelected` | 侧栏选中的标签行 | `black2` | `one_bg` |
| 其余组件 token | 标签行悬停、分屏行、地址栏、卡片描边、菜单项、玻璃 | `aui.ComponentTokens` 从上面的 token 取 | 同左 |
| `RowStep` | 行和控件比紧凑档高多少 | 见 §5 | 同左 |

规则：

- 有底色的格子只取 `base_30` 的键，不混色；悬停、按下、选中都是表里颜色加透明度。
- 和 #11 那张表的不同：暗色的正文卡片 #11 写的是 `one_bg`，这里用 `black`。原因：编辑器铺满卡片，base46 给编辑器的底色是 `base00`，77 个暗色主题里 75 个 `base00` 就是 `black`；当前行 `black2` 比 `black` 亮、比 `one_bg` 暗，卡片用 `one_bg` 时当前行会比底色还暗。`one_bg` 改给 `BgRaised`。
- `TextOnAccent` 取 `black`，和 base46 自己一样（`PmenuSel`、状态栏模式块都是彩色底配 `black` 字）。

`*ui.Theme`（MyGo 自己的控件读）取 token 里它有字段的那些：`Background` = `BgPage`，`Surface` = `BgWindow`，`Accent` = `AccentFill`，`Spacing` 取 §5 的密度，等等，见 `build.go` 的 `project`。

ACard 组件的 token（`acard.go` 的 `acardOf`）也从这些 token 映射：`Background` = `BgPage`，`Surface` = `BgField`，`SurfaceRaised` = `BgOverlay`，`SurfaceMuted` = `FillHover`，`Accent` 和 `AccentStrong` 都是 `AccentFill`；控件的边框照 RFC 0003 §5 设为透明；控件高度按 §5 的密度。

## 4. 编辑器、Markdown、终端

照 base46 自己给 Neovim 用的规则（`integrations/defaults.lua`、`syntax.lua`、`treesitter.lua`、`blankline.lua`、`lsp.lua`、`term.lua`）。`base0X` 来自 `base_16`，其余来自 `base_30`。

**编辑器**

| 编辑器里的 | 来源 | 说明 |
|---|---|---|
| 底色 | `BgPage` | 和卡片同色；base46 是 `base00`，98 个主题里 95 个两者相同 |
| 正文、光标 | `base05` | |
| 行号、当前行号 | `grey`、`white` | |
| 当前行 | `black2` | |
| 选区 | `base02`；编辑器没焦点时 `base02@0.6` | |
| 搜索匹配、当前匹配 | `base0A@0.3`、`base09@0.45` | base46 是整块底色并把字改成 `base01`；我们的编辑器只画底色、字保留语法色，所以加透明度 |
| 和选中文字相同的其他文字 | `base02@0.6` | base46 的 `LspReferenceText` 是 `one_bg3`，比选区 `base02` 还深；这里比选区淡 |
| 配对括号 | `grey` | |
| 缩进线、当前作用域的缩进线、换行参考线 | `line`、`grey`、`line` | |
| 空白符 | `base03` | |
| 增、删、改 | `green`、`red`、`yellow` | |
| 错误、警告、信息、提示 | `red`、`yellow`、`green`、`purple` | |

**语法**

| 语法 | 来源 |
|---|---|
| 关键字 | `base0E` |
| 函数、方法 | `base0D` |
| 类型、标签、属性、注解和预处理 | `base0A` |
| 字符串 | `base0B` |
| 数字、常量 | `base09` |
| 字段、参数、模块 | `base08` |
| 转义、正则 | `base0C` |
| 正文、变量、运算符 | `base05` |
| 括号、分隔符 | `base0F` |
| 注释 | `grey_fg`（设置 `italicComments` 打开时斜体） |
| Markdown 标题、链接、行内代码 | `base0D`（粗体）、`base08`、`base09` |
| diff 增、删，无效 | `green`、`red`、`red` |

**Markdown 阅读视图**：正文、次要文字、链接、边框、标记取 §3 的 token；代码块底色是 `FillHover` 叠在 `BgPage` 上；代码高亮用上面的编辑器配色；行高取 §5 的密度。

**终端**：前景 `base05`，背景 `BgPage`，16 色依次是 `base01`、`08`、`0B`、`0A`、`0D`、`0E`、`0C`、`05`、`03`、`08`、`0B`、`0A`、`0D`、`0E`、`0C`、`07`（`term.lua`）。

## 5. 密度

数值参考 Alma 的三档（控件高 2.25 / 2.5 / 2.75rem，卡片内边距 1.25 / 1.5 / 1.75rem，行高 1.4 / 1.5 / 1.65）。紧凑档就是改之前的尺寸，另外两档按 Alma 每档的增量往上加。

| 档位 | 行和控件加高（`RowStep`） | 间距单位（`ui.Theme.Spacing`） | 阅读视图行高 |
|---|---|---|---|
| 紧凑（默认） | 0 | 8 | 1.65 |
| 舒适 | 4 | 10 | 1.75 |
| 宽松 | 8 | 11 | 1.9 |

- `RowStep` 加到：侧栏行（28）、标签行、分屏行和地址栏（34）、文件树行（26）、ACard 控件的三种高度（28 / 32 / 36）。
- 间距单位决定卡片四周的留白和 MyGo 控件的内边距。
- 编辑器的行高不归密度管，仍是设置 `lineHeight`，默认 Zed 的 1.618。

## 6. 设置

`appearance.json` 里和主题有关的键：

- `theme`：`system`、`light`、`dark`。
- `lightTheme`、`darkTheme`：base46 主题名，默认 `one_light`、`onedark`。
- `density`：`compact`、`comfortable`、`spacious`。

删掉的键：`editorTheme`、`accentColor`、`treeDensity`、`spacing`。项目没有用户，不写迁移。

## 7. 没做的

- 编辑器的画法对齐 Zed：当前行连行号栏一起高亮、行号栏至少 4 位数字宽。这两处是 MyGo 编辑器的绘制代码（行号栏最少 3 位写死在 `editor/state.go`，当前行只画正文区），要在 MyGo 上游改。
- 聊天里用户消息的底色（#11 表里的 `darker_black` / `one_bg2`）：聊天用 ACard 的组件，等聊天界面重画时接。
- `Mount.Color`：项目颜色还在固定区的项目文件夹、起始页和颜色菜单里，界面重画时一起处理（RFC 0003 §5）。
- 直接读 NvChad 的 `.lua` 主题：用户主题现在只认 JSON。
