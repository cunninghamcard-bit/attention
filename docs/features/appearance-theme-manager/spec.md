spec: task
name: "appearance-theme-manager"
inherits: project
tags: [feature, sdd]
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

让 Appearance > Themes > Manage 提供与 Obsidian 社区插件管理器一致的社区资源操作面板。
用户应能在同一个弹窗内搜索、排序、筛选、浏览主题详情，并完成使用、安装和卸载；现有
主题目录、vault 存储和主题应用服务继续作为唯一数据与状态来源。

## Current State

当前 `ThemeMarketplaceModal` 只有搜索框、扁平列表和“安装并使用”按钮，不能展示默认主题、
已安装 vault 主题、主题预览或详情，也没有安装筛选、排序和卸载操作。项目已经有
`CommunityPluginMarketplaceModal` 的侧栏/详情布局，以及 `ThemeMarketplace`、`ThemeInstaller`
和 `ThemeManager` 可复用。

## UX Shape

```text
Community themes
├─ sidebar: search · sort · installed only · result count · theme cards
└─ details (after selection): name/downloads/version/author/repository · actions · README
```

## Decisions

- 复用 `CommunityPluginMarketplaceModal` 已使用的 `mod-community-modal`、`modal-sidebar`、
  `community-item` 和 `community-modal-details` DOM/CSS 约定，不抽取新的共享基类。
- 列表始终包含 `Default`；其它条目来自远程社区目录与当前 `ThemeManager` 已加载的 vault
  主题，按 id 去重，默认主题排在最前。
- 搜索按主题名和作者进行分词模糊匹配，并高亮命中字符；排序提供 Most downloaded、
  Recently released、Alphabetical，排序偏好使用 `localStorage` 保存。
- 已安装筛选同时识别 `ThemeInstaller` 当前会话记录和 `ThemeManager` 已加载的 vault 主题。
- 详情操作使用现有安装/启用链路；卸载删除 vault 主题目录、取消当前主题并重新读取主题。
- 详情从主题仓库加载 `manifest.json` 和 `README.md`，补全版本、作者、描述与说明文档；
  仓库信息不可用时保留目录元数据和明确的 README 空状态。
- README 同时支持 Markdown 和经清理的 HTML 片段；主题仓库中的相对 `img/video` 资源按
  Obsidian 的 raw 仓库 URL 规则解析。
- README 与阅读视图共用全局 `MarkdownInlineRenderer`：标准 Markdown 内联语法交给项目
  已安装的 Markdown parser，Obsidian 的 wiki/embed、tag、math、comment、block id 和
  footnote 扩展在同一条安全渲染链路中补齐，不创建 Theme Market 专用解析器。
- 块级与内联解析统一使用同一个已配置的 `stream-markdown-parser` 实例；
  `MarkdownRenderer` 消费该解析器的 block token 分组并保留 token 行号映射，
  不保留手写的 `MarkdownBlockParser` 或另一套块级语法实现。
- block token 渲染仍按 section 执行现有 postprocessor、code-block replacement、task-list、
  blockquote、table 和 footnote 流程；解析器切换不得改变这些可观察的 DOM 与行号语义。
- 选择主题只更新详情区和选中状态，不重建侧栏主题卡片，保持列表节点和滚动位置。
- 主题卡片预览使用目录中的 screenshot URL；没有预览图时显示原生空占位，不阻塞主题安装。

<!-- lint-ack: decision-coverage — The manager-layout and filtering scenarios verify the reused shell, matching, sorting and installed-only behavior. -->

## Boundaries

### Allowed Changes

- src/renderer/builtin/theme-market/ThemeMarketplaceModal.ts
- src/renderer/builtin/theme-market/ThemeInstaller.ts
- src/renderer/builtin/theme-market/ThemeMarketplace.ts
- src/renderer/index.ts
- src/renderer/markdown/MarkdownBlockParser.ts
- src/renderer/markdown/MarkdownInlineRenderer.ts
- src/renderer/markdown/MarkdownRenderer.ts
- src/renderer/styles/index.css
- src/renderer/styles/product/theme-market.css
- tests/web/builtin/theme-market/ThemeMarketplaceModal.test.ts
- tests/web/builtin/theme-market/ThemeMarket.test.ts
- tests/web/markdown/MarkdownPreviewRenderer.test.ts
- docs/features/appearance-theme-manager/**

### Forbidden

- 不添加依赖、React 组件或第二套市场数据模型。
- 不修改社区插件管理器的行为或主题的 vault 存储格式。
- 不复制 `decode-obsidian/**` 的实现代码，只复现可观察的交互结构。

## Completion Criteria

Rule: manager-layout — 管理器沿用社区插件的侧栏详情交互
Scenario: 主题管理器渲染侧栏和详情
Test:
Filter: renders the Obsidian-style theme manager
Level: component
Given 社区主题目录中有两个主题
When 用户打开 Manage
Then 弹窗包含搜索、排序、Installed only 和主题卡片
And Default 与已安装主题出现在可浏览列表中
And 选择主题后出现详情区域
And 详情展示下载量、版本、作者、仓库和 README

Scenario: 搜索排序和已安装筛选更新列表
Test:
Filter: filters and sorts theme manager entries
Level: component
Given 社区主题目录中有两个主题且其中一个已安装
When 用户输入搜索词、切换排序并打开 Installed only
Then 列表只显示匹配且已安装的主题
And 名称或作者中的模糊命中字符被高亮
And 排序偏好被保存

Rule: manager-actions — 详情操作改变主题状态
Scenario: 安装并使用主题
Test:
Filter: installs and uses a theme from the manager
Level: component
Given 用户打开一个未安装社区主题的详情
When 用户点击 Install and use
Then 主题写入 vault、主题配置变为该主题并显示 Stop using

Scenario: 使用和卸载已安装主题
Test:
Filter: uses and uninstalls an installed theme
Level: component
Given 一个已安装但未使用的主题正在展示
When 用户点击 Use 后再点击 Uninstall
Then 主题配置先切换到该主题、随后恢复 Default
And 主题目录被删除且列表不再标记为 Installed

Rule: manager-fallbacks — 目录状态可恢复
Scenario: 目录加载失败可重试
Test:
Filter: retries a failed theme catalog load
Level: component
Given 社区主题目录第一次加载失败
When 用户打开 Manage 并点击 Retry
Then 弹窗显示可操作的失败状态
And 第二次加载成功后主题卡片恢复显示

Scenario: 主题没有预览图仍可使用
Test:
Filter: handles a theme without a screenshot
Level: component
Given 主题目录条目没有 screenshot
When 用户打开该主题详情
Then 主题卡片显示原生预览占位
And 使用操作仍然可用

Rule: global-inline-markdown — README 使用全局 Obsidian 内联 Markdown 语义
Scenario: 全局渲染标准 Markdown、Obsidian 扩展和安全 HTML
Test:
Filter: renders complete Obsidian inline markdown globally
Level: integration
Given 文档同时包含嵌套 emphasis、链接图片、HTML、wiki/embed、tag、math、comment、block id 和 footnote
When 文档通过全局 MarkdownRenderer 渲染
Then 标准 Markdown 使用正确的嵌套 DOM 结构
And Obsidian 扩展生成与源码一致的 class、data 属性和 footnote 区域
And 危险 HTML 属性被移除且转义语法保持为普通文本

Scenario: 统一块级解析保留 section 和 postprocessor 语义
Test:
Filter: preserves sections and postprocessors with the unified block parser
Level: integration
Given 文档包含 heading、task list、blockquote、table 和 fenced code block
When 文档通过全局 MarkdownRenderer 渲染
Then 每个顶层 block 都生成独立 section 并保留 0-based 行号范围
And task checkbox、blockquote、table 和 fenced code block 的 DOM 结构保持可用
And 注册的 code-block postprocessor 能替换对应 section 并读取原始行号

## Out of Scope

- 重新实现 Obsidian 编辑器的 Live Preview Markdown 引擎
- 为 Theme Market 单独维护 Markdown parser 或 Markdown DOM renderer

## Open Questions

None.
