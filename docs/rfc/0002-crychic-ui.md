# RFC 0002：采用 shadcn/ui 模式将 CrychicUI 按需内化至 `native/ui` 并移除外部 UI 库依赖

- 状态：Draft
- 日期：2026-11-02
- 范围：`native/ui`（新建）、`native/plugins/*`、`native/internal/textdoc`、`native/internal/fileicon`、`native/go.mod`
- 关联文档：[RFC 0001](0001-go-native-plugin-browser.md) · [产品线规划](../product.md) · [外观系统](../appearance.md)

---

## 1. 摘要

借鉴现代前端 **`shadcn/ui` 的「源码内化（Copy-and-Own / Vendoring）」模式**，不再将 UI 组件库作为黑盒第三方依赖引入，而是以 [`ELY-Open-Source/CrychicUI`](https://github.com/ELY-Open-Source/CrychicUI)（MIT 协议，1500 个 MyGo 原生组件）为组件源码库，**将其底层 `icon`、`kit` 及所需组件按需内化至本仓库的 `native/ui/` 目录中，直接升级运行在最新的 `mygo v0.7.2+` 之上，并按 `attention` 的编辑器/浏览器审美进行去玩具化改造**。

同时，从 `native/go.mod` 中彻底移除 `attention-ui`（含本地 `replace` 指令）、`smallnest/uix` 与 `oneo-me/onevra`。

---

## 2. 背景与动机

### 2.1 现有外部黑盒依赖的痛点

1. **四层 UI 库混杂**：当前 `native/` 同时依赖 `mygo/ui`、`smallnest/uix v0.2.3`（基于 `mygo v0.4.5`）、`oneo-me/onevra v0.2026.13`（基于 `mygo v0.5.5`）以及从 GitHub 客户端 `octogo` 拆出的 `attention-ui`（通过 `replace => ../../octogo/attention-ui` 本地路径挂载）。
2. **黑盒依赖无法自由改样式**：
   - 直接 `import` 外部组件库（无论是 `uix` 还是原版 `CrychicUI`）都会面临上游版本滞后（停留在 `mygo v0.4.5` / `v0.5.5`）和样式锁死的问题；
   - 原版 `CrychicUI` 虽然拥有 38 个分类、1500 个组件（涵盖 `files`、`code`、`navigation`、`desktop`、`agent` 等丰富场景），但其默认视觉带有明显的 Demo 玩具感（每次点击触发 `sound` 合成蜂鸣器音效、夸张的 `0.97` 按压缩放、厚重的卡片边框），且其中大量电商/金融/游戏组件并非编辑器所需。

### 2.2 为什么采用前端 `shadcn/ui` 的「按需内化 + 自主修改」模式？

在 React/TS 生态中，`shadcn/ui` 证明了最佳的组件库组织方式不是 `npm install` 一个不可修改的黑盒包，而是**把组件源码直接放进业务仓库自己的 `ui/` 目录中**：

- **100% 掌控视觉与交互**：组件源码就在 `native/ui/` 下，可以随时去掉蜂鸣音效、调小行高、去掉生硬边框、改为类似 Arc 浏览器的柔和无框胶囊或高密度工作台风格；
- **直接对齐最新 `mygo v0.7.2+`**：不受上游组件库 `go.mod` 版本的束缚；
- **按需取用、零冗余膨胀**：把 `CrychicUI` 的 1500 个组件（以及未来看中的优秀 TS 组件）当作「上游素材库」，用到哪个组件就提炼内化哪个组件到 `native/ui/`，仓库保持极度精简。

---

## 3. 架构与目录设计

### 3.1 `native/ui/` 目录结构

在 `native/` 下新建一等公民包 `native/ui`（及图标子包 `native/ui/icon`），全面替代 `github.com/cunninghamcard-bit/attention-ui/ui`（`omgui`）和 `github.com/smallnest/uix/components/lucide`：

```text
native/
  ui/
    icon/
      svg/*.svg        # 源自 CrychicUI/icon：内嵌 Lucide 1.58.0 SVG 图标（ISC/MIT）
      icon.go          # Must(name), Filled(name), Names() — 懒加载与线程安全缓存
    kit.go             # 源自 CrychicUI/kit（去掉 sound 音效与夸张缩放，保留平滑过渡、Settle、Marked 文本高亮）
    button.go          # 按钮体系：Button, IconButton, Soft, Ghost, Outline, Destructive
    input.go           # 输入体系：Field, SearchField, NumberField（源自 CrychicUI/input 并紧凑化）
    choice.go          # 选择与开关：Select / Dropdown, SettingsToggle / Toggle（源自 CrychicUI/choice）
    overlay.go         # 浮层与菜单：Dialog / Modal, IconMenu / Menu, Frost（源自 CrychicUI/overlay）
    glass.go           # 液态毛玻璃与滑动透镜原语：Frosted / LiquidGlass 着色器 + Gliding Pill / Lens 指示器
    row.go             # 列表与导航行：SideRow（树/面板行）、SidebarItem、CommandRow
    settings.go        # 设置页排版：SettingsSection, PreferenceRow, SectionLabel
```

后续在推进 V2（浏览器化工作区）和 V3（AI 导读流）时，可随时从 `CrychicUI` 对应分类或参考 [`uiarc.dev`](https://uiarc.dev) 的交互设计按需内化组件到 `native/ui/`：
- **液态玻璃导航与滑动胶囊（参考 `uiarc.dev/components/glass-tabbar` & `CrychicUI/fx/frosted.go` + `navigation/pill_tabs.go`）**：
  - 利用 MyGo 原生 GPU 片段着色器（`mygo/ui/shader` 的 `backdropSample(pos)` + `BackdropBlur` + 边缘折射/高光）与跨节点共享过渡（`ui.ElementTransition{Animation: &ui.Snappy, Match: mark{id}}` + `Draggable`），在 `native/ui/glass.go` 中原生实现液态玻璃悬浮栏、滑动放大透镜（Gliding Lens）与胶囊分段器（Segmented / Pill Tabs）。
- `CrychicUI/files/column_browser.go` → 分栏式文件夹浏览（`ColumnBrowser`）
- `CrychicUI/code/file_header.go`、`breadcrumb.go` → 文件顶部路径与所属项目头栏
- `CrychicUI/agent/source_card.go`、`citation.go`、`thinking.go` → AI 原文引用卡片与思考状态
- `CrychicUI/motion/card_stack.go`、`swipe_actions.go` → V3 导读卡片左右滑分拣（Swipe Triage）

### 3.2 对 `CrychicUI` 迁入代码的「去玩具化」改造准则

所有从 `CrychicUI` 内化到 `native/ui/` 的代码，统一执行以下 4 项改造：

1. **移除 `sound` 包与音效调用**：
   - 不迁入 `CrychicUI/sound`；删除所有 `sound.Play(...)`、`kit.Clicked(e, sound.Tap)`，保持纯粹的桌面编辑器交互体验。
2. **收敛夸张动效，保留细腻过渡**：
   - 去掉 `kit.Lift`（悬停上浮 `-2 DIP`）和夸张的 `Scale: 0.97` 弹簧按压抖动；
   - 保留 `AnimateColor`（悬停/选中背景与文字颜色平滑过渡，`ui.Snappy`）和克制的浮层入场过渡（`Enter` / `Arrive`）。
3. **增强组合能力（支持 `*ui.SVG` 与自定义子视图）**：
   - 原版 `CrychicUI/button` 只接收字符串 `iconName string`（强制走内置 Lucide）；
   - 内化后的 `native/ui` 同时支持传入 `*ui.SVG`（从而无缝兼容 `internal/fileicon` 中的 `@pierre/trees` 文件类型图标与动态染色）以及 `icon.Must("...")`。
4. **去掉死板外框，适配高密度桌面工作台**：
   - 侧边栏列表行（`SideRow` / `SidebarItem`）和标签栏采用无边框圆角胶囊（Hover / Active 半透明叠色），避免层层套框。

---

## 4. 主题、图标与组件迁移方案

### 4.1 移除 `attention-ui/theme`，统一至 `internal/textdoc/theme.go`

- 目前全库仅在 [`internal/textdoc/theme.go`](../../native/internal/textdoc/theme.go)、[`plugins/search`](../../native/plugins/search/search.go) 和 [`plugins/backlinks`](../../native/plugins/backlinks/backlinks.go) 中引用了 `attention-ui/theme`（`theme.For` 与 `theme.MonoFont`）。
- 迁移方式：
  1. 将 `theme.For(dark, k.accent)` 的基础调色板逻辑直接内聚进 [`internal/textdoc/theme.go`](../../native/internal/textdoc/theme.go)（基于 `ui.LightTheme()` / `ui.DarkTheme()` 构建，叠加内置 `themes/*.json` 的 `Attention Light` / `Attention Dark` / `Ayu` / `One`）；
  2. `search` 与 `backlinks` 中的 `theme.MonoFont` 统一改为 `textdoc.MonoFont`；
  3. 彻底删除对 `github.com/cunninghamcard-bit/attention-ui/theme` 的依赖。

### 4.2 图标迁移（`uix/components/lucide` → `native/ui/icon`）

将全库 18 个插件包及 [`internal/fileicon`](../../native/internal/fileicon/fileicon.go) 中的 `lucide.<Name>()` 统一替换为 `native/ui/icon`（源自 `CrychicUI/icon`）：
- 提供 `icon.Must("folder")`、`icon.Must("chevron-right")` 等标准 kebab-case 查表接口；
- 为平滑过渡并保持编译期可读性，也可在 `native/ui/icon` 中提供常用图标的薄封装或直接使用 `icon.Must(...)`（由单元测试校验所有引用的图标名均存在于 `svg/` 嵌入目录中）。

### 4.3 `omgui` 调用点全量迁移对照表

| 现有调用 (`attention-ui/ui`) | 迁移目标 (`native/ui`) | 涉及插件 |
|---|---|---|
| `omgui.Button` / `ButtonProps` | `ui.Button` / `ui.IconButton` | `layout`, `workspace`, `filetree`, `settings`, `appearance`, `shortcuts`, `bookmarks`, `markdownui`, `web`, `terminalui` |
| `omgui.Field` | `ui.Field`（源自 `CrychicUI/input`） | `appearance`, `web`, `palette`, `shortcuts` |
| `omgui.SearchField` | `ui.SearchField`（源自 `CrychicUI/input`） | `settings`, `search`, `bookmarks`, `shortcuts` |
| `omgui.NumberField` | `ui.NumberField`（源自 `CrychicUI/input`） | `appearance` |
| `omgui.Select` / `SelectOption` | `ui.Select`（源自 `CrychicUI/choice`） | `appearance` |
| `omgui.SettingsToggle` | `ui.SettingsToggle`（源自 `CrychicUI/choice`） | `appearance` |
| `omgui.Dialog` / `DialogProps` | `ui.Dialog`（源自 `CrychicUI/overlay`） | `settings` |
| `omgui.IconMenu` / `MenuItem` | `ui.IconMenu` / `ui.MenuItem` | `workspace`, `web` |
| `omgui.SideRow` / `SidebarItem` | `ui.SideRow` / `ui.SidebarItem`（融合 `CrychicUI/kit` 平滑高亮） | `filetree`, `outline`, `backlinks`, `bookmarks`, `webhistory`, `settings` |
| `omgui.CommandRow` / `Frost` | `ui.CommandRow` / `ui.Frost` | `palette` |
| `omgui.SettingsSection` / `PreferenceRow` / `SectionLabel` | `ui.SettingsSection` / `ui.PreferenceRow` / `ui.SectionLabel` | `settings`, `appearance`, `filetree`, `shortcuts` |

---

## 5. 实施计划与验收标准

### 5.1 实施步骤

1. **Step 1：建立 `native/ui/icon` 与 `native/ui`**
   - 从 `CrychicUI` 迁入 `icon`（含 `svg/*.svg` 与 `THIRD_PARTY_NOTICES` 说明）和 `kit` 核心辅助函数；
   - 实现去玩具化改造后的 `button.go`、`input.go`、`choice.go`、`overlay.go`、`row.go`、`settings.go`，并编写组件单测。
2. **Step 2：内聚主题并解耦 `attention-ui/theme`**
   - 在 `internal/textdoc/theme.go` 中内聚基础亮/暗主题构造逻辑，替换 `search` 和 `backlinks` 中的 `theme.MonoFont`。
3. **Step 3：全量切换图标与插件 UI 引用**
   - 将 `internal/fileicon`、`examples/hello-ui` 及全部 18 个插件的导入从 `attention-ui/ui` 和 `smallnest/uix/components/lucide` 切换至 `native/ui` 和 `native/ui/icon`。
4. **Step 4：清理 `native/go.mod` 并通过全部门禁**
   - 删除 `attention-ui`（含 `replace` 指令）和 `smallnest/uix`，执行 `go mod tidy`；
   - 更新 `native/AGENTS.md` 中的 UI 组件规范说明。

### 5.2 验收门禁

- `native/go.mod` 中不再包含 `attention-ui`、`smallnest/uix`、`oneo-me/onevra`，且不存在任何本地路径 `replace` 指令；
- `cd native && gofmt -l . && go vet ./... && go test ./...` 全部通过；
- `cd native && GOWORK=off asl -forwarder=false ./...` 布局静态检查全部通过。
