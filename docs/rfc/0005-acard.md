# RFC 0005：换用 ACard 组件，改名 Acard，发布 0.1.0

- 状态：草案（2026-11-07）
- 日期：2026-11-07
- 前提：ACard UI 迁移完成（§2）
- 范围：`native/`（整个 Go 原生线）、仓库名、发版流程
- 关联：[RFC 0002](0002-crychic-ui.md)（引入 CrychicUI 的部分由本 RFC 取代）、[RFC 0003](0003-arc-layout.md)、[RFC 0004](0004-theme-tokens.md)；octogo 的 RFC 0001（同一前提，两边同步进行）；ACard UI 的 `ARCHITECTURE.md`

## 1. 顺序

1. 等 ACard UI 迁移完成（§2）。
2. 把 `native/ui` 的组件换成 ACard（§3）。
3. 改名 Acard（§4）。
4. 发布第一个版本 0.1.0（§5）。

四步串行：上一步验收后，下一步才开始。

## 2. 前提：ACard 迁移完成

满足以下全部条件，才算完成：

- `acard-ui` main 上，`ref/arc/catalog.json` 里属于 ACard `ARCHITECTURE.md` §7 范围的 Free 和 Pro 条目都已合入；没合入的，每一条都登记了原因（不移植或停放），并由用户确认。
- `acard-ui` 推到 GitHub 私有仓库 `cunninghamcard-bit/acard-ui`，打 tag `v0.1.0`。
- 那个 tag 上 `gofmt -l . && go vet ./... && go test ./...` 全绿。

2026-11-07 的状态：`acard-ui` main 有 237 个非测试 Go 文件；流水线（`~/Projects/acard-pipeline`）还有 50 个 Pro 组件在处理，其中已合并 2 个、停放 2 个，其余在审查或修复。

## 3. 换组件

### 3.1 原则

- 只留一套组件：ACard 有的组件，attention 直接用，不再自己画。
- `native/ui` 只保留 attention 自己的组合件，也就是 RFC 0003 的 Arc 式窗口独有的东西：标签行、分屏行、地址栏、侧栏行、玻璃效果、设置页布局。这些组合件用 ACard 的组件和 token 组合，不另写行为。
- 行为：RFC 0002 从 CrychicUI 引入的 headless 部分，换成 ACard 使用的 MyGo `*Base`。RFC 0002 的这一部分作废；`native/ui/THIRD_PARTY_NOTICES.md` 里不再用到的条目删掉。
- token：保留 RFC 0004 的三层结构。
  - 色板和语义 token 仍由 `plugins/appearance` 生成，再经 `acard.Register(theme, tokens)` 写进 ACard 的 `Tokens`。
  - `native/ui` 组件 token 中 ACard 已经覆盖的条目删掉，只留组合件用到的。
- 图标：`native/ui/icon` 换成 `acard-ui/icon`，两者都是 Lucide。
- ACard 缺某个能力时，改 `acard-ui`，发新 tag，再升级。不在 attention 里另做一份。
- 依赖：
  - 用 tag 版本，不用 `replace` 或 `go.work`；
  - MyGo 升到 `acard-ui` 的 `go.mod` 用的版本（现在是 `v0.7.5-0.20261104191142-c9438876cbd1`）。

### 3.2 对照表

现在有 22 个文件引用 `native/ui`，28 个文件引用 `native/ui/icon`。

| `native/ui` 现有 | ACard | 说明 |
|---|---|---|
| `Button` | `Button` | |
| `Select` | `Select` | |
| `Switch`、`SettingsToggle` | `Switch` | |
| `Segmented` | `SegmentedControl` | |
| `SearchField` | `SearchField` | |
| `Field` | `Input` | |
| `NumberField` | `NumberField` | |
| `Tooltip` | `Tooltip` | |
| `Popover`、`Floating` | `Popover` | |
| `IconMenu` | `DropdownMenu` | |
| `Dialog` | `Dialog` | |
| `Card` | `Card` | |
| `Disclosure` | `Accordion` 的展开箭头 | |
| `Register`、`TokensOf`、`TokensFor`、`DerivedTokens`、`ComponentTokens` | `acard.Register`、`acard.TokensOf` | 组合件的局部 token 仍留在 `native/ui` |
| `TabRow`、`SplitRow`、`SideRow`、`SidebarItem`、`AddressBar`、`CommandRow` | 无 | 留作组合件，内部改用 ACard |
| `LiquidGlass`、`Frost` | 无 | 留作组合件（Arc 浏览器式窗口的外观，ACard 里没有） |
| `SectionLabel`、`SettingsSection`、`PreferenceRow` | 无 | 留作设置页的组合件 |
| `Dot` | 无 | 文件树根目录还在用，留着 |

### 3.3 步骤

1. 升级 MyGo，加 `acard-ui@v0.1.0` 依赖；native 的所有门禁全绿（gofmt、vet、asl 三个平台、`go test ./...`、CLI e2e）。
2. 接 token：让 appearance 产生的每个主题都经 `acard.Register` 登记，截图对比亮色、暗色和各个强调色。
3. 按 §3.2 的表逐个替换，一个组件一个提交，删掉 `native/ui` 里对应的实现。
4. 组合件改用 ACard 的组件和 token。
5. 验收：
   - 门禁全绿；
   - 设计稿的四屏（窗口、起始页、Omnibox、外观设置）在应用里各截一张亮色和一张暗色，和设计稿对照。

## 4. 改名 Acard

产品名定为 **Acard**。组件库仍叫 ACard UI（仓库 `acard-ui`，包名 `acard`），和应用是两个仓库。

改动范围（Go 原生线）：

| 项 | 现在 | 改为 |
|---|---|---|
| GitHub 仓库 | `cunninghamcard-bit/attention` | `cunninghamcard-bit/acard`（GitHub 会自动把旧地址重定向过来） |
| Go module | `github.com/cunninghamcard-bit/attention/native` | `github.com/cunninghamcard-bit/acard/native` |
| 可执行文件和 CLI 命令 | `attention` | `acard` |
| 服务进程（`launcher.ServicesName`） | 按 `attention` 命名 | 按 `acard` 命名 |
| 环境变量 | `ATTENTION_*` | `ACARD_*` |
| 配置目录 | `~/Library/Application Support/attention` | `~/Library/Application Support/Acard` |
| CLI socket | `attention-cli.sock` | `acard-cli.sock` |
| 应用名（`mygo.App.SetName`、窗口标题、菜单） | `attention` | `Acard` |
| 本地目录 | `~/Projects/attention` | `~/Projects/acard` |

- 不迁移旧的配置目录、socket 和环境变量：现在还没有用户。
- TS 旧线（`apps/`、`packages/`、Electron 桌面）不在 0.1.0 范围内，不改名。
- 改名单独做一组提交，不和换组件混在同一个提交里。

## 5. 发布 0.1.0

- 版本号 `0.1.0`，tag `v0.1.0`。
- 平台：只发 macOS arm64，这是目前唯一实际跑过的平台。
- 产物：
  - `Acard.app`，里面带上 `rutis-host` 和服务进程的二进制，压成 zip，作为 GitHub Release 的附件发布；
  - 同一个 Release 附上 CLI 的单独二进制 `acard`。
- 发版前必须全部通过：
  - 门禁全绿：根目录的 `mise run gate`，加上 native 的全部门禁；
  - 用打包出的 `.app`（不是开发版）、全新的配置目录启动一次，走一遍下面这些操作：
    - 打开项目，打开文件；
    - 新开标签，分屏，用 ⌘W 关掉标签；
    - 打开网页标签和终端；
    - 在外观设置里切换主题和强调色；
    - 用 CLI 跑 `acard files`、`acard read` 和 `acard search`。

## 6. 待定

1. **公开仓库依赖私有组件库。** attention 是公开仓库；`acard-ui` 带有 Arc Pro 的移植代码，只能是私有仓库。换成 ACard 以后，外部的人拿到 attention 的公开源码也构建不出来。
   - 选项 A：发版前把仓库改成私有。
   - 选项 B：保持公开，接受源码不能独立构建，只通过 Release 发二进制。CI 要用能读 `acard-ui` 的 token。
   - 建议 B：二进制里带 Pro 组件是正常的成品使用；公开仓库本身不包含 Pro 源码。
2. **Bundle identifier。** 发版前要定一个正式的值。
3. **签名和公证。** 需要 Apple Developer 账号。建议首版不公证，用户第一次打开时右键选「打开」，等有外部用户再做。
