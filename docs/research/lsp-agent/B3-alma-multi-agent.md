## B3 Alma 的多智能体设计

### 核心概念
**子 agent（subagent）**：由 Task 工具派生、以 `subagent:<taskId>` 运行的执行体，消息挂在父线程的工具调用上，不另开线程。
**parentToolCallId**：子 agent 消息回挂父线程中 Task 工具调用的标识。
**slot_id（版本组）**：同一 slot_id 的消息构成同一位置的多个版本，读取时计算 versionIndex 与 versionCount。
**activePath**：当前分支的消息 ID 列表，存于 chat_threads.metadata。
**mission / run / handoff**：mission 由根消息触发；run 是子 agent 的每次执行；handoff 是专家之间的委派，携带结构化 packet。
**Sprint Harness**：可选模式，Planner 拆 sprint，Generator 实现，Evaluator 按合同打分。
**reference_open**：唯一的指令型广播事件，驱动渲染端打开 file 或 thread 引用。

### 关键事实
**版本与存储**
- 当前版本为 Alma 0.4.509（Info.plist 的 CFBundleShortVersionString 与 alma-server/VERSION 一致）。 `~/Projects/alma-ref/app/Info.plist`
- chat_threads.workspace_id 为 ALTER 追加的可空外键，ON DELETE SET NULL。 `~/Projects/alma-ref/app/alma-server/lib/server.mjs`（createTables 迁移块）
- 消息树由 parent_id、slot_id、depth 三列构成；删除中间节点时子消息改挂到祖父节点。 `server.mjs`（getMessagesByThreadId；删除消息事务）
- 数据库为 chat_threads.db，WAL 模式，busy_timeout=5000，foreign_keys=ON。 `server.mjs`（initialize）

**子 agent**
- Task 工具调用 Iue() 建任务记录；sessionId 为 `subagent:<taskId>`；subagentMessageId 形如 `subagent-<taskId>-<ts>`。 `server.mjs:5014, 5017, 5415`
- 流式 delta 在内存 Map subagentAccumulators 中按 seq 去重聚合，每 1000ms 最多落库一次。 `server.mjs:11077-11078`
- 推送事件为 subagent_message_added、subagent_message_delta、subagent_message_completed。 `server.mjs:11078`
- 快照接口：GET /api/threads/:id/subagents/live；持久化读取：GET /api/threads/:id/subagent-messages。 `server.mjs:11033, 11077`
- 渲染端加载线程时并行请求两个接口，live 快照按 parentToolCallId 合并进 store。 `~/Projects/alma-ref/app/renderer/assets/mermaid-NA5CF7SZ-DVyuPqor.js`（ChatLayout）
- Claude Code CLI 路径崩溃时自动重试最多 2 次，失败后回退内置 agent。 `server.mjs:5415`
- 应用重启后，中断的子 agent 从 transcript 自动恢复。 `server.mjs:11790`
- 主 agent 默认 stopWhen 为 stepCountIs(20)；子 agent 的 maxSteps 默认 100。 `server.mjs:225, 5435`
- 子 agent 工具集按类型裁剪：alma-guide 无 Bash/Edit/Write；alma-operator 仅 Bash 与 Read。 `server.mjs:5435`

**Mission 与 Crew**
- 四张表：agent_missions、agent_runs、agent_handoffs、mission_sprints，均挂在线程下；(thread_id, root_message_id) 唯一。 `server.mjs:750, 764, 781, 795, 1294`
- handoff packet 字段：goal、context、constraints、deliverable、acceptanceCriteria、artifactRefs、writeBack。 `server.mjs:5012`
- 每个 sprint 的最大重试默认 5，范围 1 至 20。 `server.mjs:5012, 5664`
- harness 角色：Planner（Plan）、Generator（coder，harnessRole generator）、Evaluator（general-purpose）。 `server.mjs:5664`
- sprint-harness 仅在用户明确要求时开启（STRICTLY opt-in）。 `server.mjs:5012`
- UI 没有独立 mission board，而是线程旁的 Agent Crew 面板，默认宽 360。 `mermaid-NA5CF7SZ-DVyuPqor.js:3021`

**agent 推 UI**
- 路径为 `alma ref open` 或 POST /api/refs/open；服务端只校验 uri，随后 broadcast reference_open 并返回 {ok:true}，无回执。 `server.mjs:7330`；`alma-server/resources/cli/alma:3838-3846`
- 渲染端 XX() 解析引用：file 在右侧 dock 的 Files 标签打开，thread 跳转到 /chat/<id>。 `mermaid-NA5CF7SZ-DVyuPqor.js:1467, 1506`
- 浏览器的 agent 标签带 origin:'agent' 与 agentTabId，不抢焦点，并替换旧的 agent 标签。 `mermaid-NA5CF7SZ-DVyuPqor.js:1507`
- `alma browser open` 走外部 Chrome relay，与 “Opened by agent” 无关。 `alma CLI:7925-7930`

**审批**
- 审批闸门 gW 对子 agent、telegram/discord/飞书/cron/heartbeat 来源及 cron 线程直接放行。 `server.mjs:4494`
- 审批默认超时 10 分钟（RUs），上限常量为 120 秒（DUs）。 `server.mjs:4494`

### 冲突与未核实
- 版本：alma-threads 称版本无法确定，抽查证伪，以 0.4.509 为准。
- 线程按工作区列出的排序方向：未核实。kn 包装函数的方向未确认，原报告的“升序”不采信。
- sprint 阶段：服务端调用可见 planning、generating；evaluating、failed 未核实。UI 文案为 Planning、Contracting、Generating、Evaluating、Iterating，与服务端集合不一致，UI 可能是派生展示（未核实）。
- 可引用对象种类：alma-quote 称 27 种，抽查数组实为 26 项，以 26 为准。
- reference_open 的广播传输层（SSE、WebSocket 或 IPC）：未核实。
- Crew harness 视图的具体渲染结构：未核实。

### 对 Acard 的设计问题
1. 子 agent 是否另开会话？Alma 以 parentToolCallId 挂在 Task 工具调用上，没有独立线程（`server.mjs:5017`）。Acard 是否也以工具调用作为挂载点？
2. 是否需要消息分支与版本？Alma 靠 parent_id、slot_id 与 activePath 实现，但线程列表无分页（`server.mjs` getThreadsByWorkspaceId）。Acard 是否要支持阅读历史的分支？
3. agent 推送 UI 是否需要回执？reference_open 是无回执的 fire-and-forget（`server.mjs:7330`）。Acard 若要确认界面真的打开，需补一个确认事件。
4. 消息网关与定时任务来源是否自动放行审批？Alma 对这些来源直接放行（`server.mjs:4494`）。Acard 需要单独确定这些来源的策略。
5. 子 agent 的步数上限与工具集如何分层？Alma 主 agent 默认 20 步，子 agent 100 步，工具集按类型裁剪（`server.mjs:225, 5435`）。Acard 是否采用同样的分层？
6. 是否引入 mission/crew 式编排？Alma 的 mission 面向对话驱动的编排，与阅读型 UI 距离较远（alma-features 推断）。Acard 是否只需要 run 记录与 handoff packet 的数据形状？

### 抽查记录

| 结论 | 题目 | 说法 | 说明 |
|---|---|---|---|
| confirmed | alma-threads | chat_threads.workspace_id 为 ALTER TABLE 追加的可空外键 REFERENCES workspaces(id) ON DELETE SET NULL | alma-ref/app/alma-server/lib/server.mjs 迁移块中原文为 ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL，与报告一致。 |
| partly | alma-threads | getThreadsByWorkspaceId 按 workspace_id 过滤并按 updated_at 排序，无分页 | 实际代码为 select().from(cr).where(ye(cr.workspaceId,e)).orderBy(kn(cr.updatedAt)).all()，过滤与排序键正确、无分页正确。但 orderBy 的方向由包装函数 kn 决定，未核实 kn 是升序还是降序，报告写的“升序”未经证实。 |
| confirmed | alma-threads | SQLite 连接 pragma：busy_timeout=5000、cache_size=-64000 等 | server.mjs 中可见 busy_timeout = 5000 与 cache_size = -64000 的 pragma 调用。 |
| wrong | alma-threads | alma-ref 版本号未能确定（Info.plist 中未找到 CFBundleShortVersionString） | alma-ref/app/Info.plist 中存在 CFBundleShortVersionString 为 0.4.509；alma-server/VERSION 也是 alma-server 0.4.509。本报告的 gap 与版本结论有误，应改为 0.4.509。 |
| confirmed | alma-subagents | 子 agent 的 subagentMessageId 格式为 subagent-${taskId}-${Date.now()} | server.mjs 中原文为 subagent-${t}-${Date.now()}，与报告一致（变量名为 t 而非 taskId，语义相同）。 |
| confirmed | alma-subagents | Task 工具 subagent_type 枚举为 general-purpose、statusline-setup、Explore、Plan、alma-guide、alma-operator、coder | server.mjs 中 subagent_type:f.enum(["general-purpose","statusline-setup","Explore","Plan","alma-guide","alma-operator","coder"])，列表完全一致。 |
| confirmed | alma-subagents | Alma 桌面 app 版本 0.4.509（Info.plist CFBundleShortVersionString） | alma-ref/app/Info.plist 的 CFBundleShortVersionString 为 0.4.509，与 alma-server/VERSION 一致。 |
| confirmed | alma-missions | 每个 sprint 的最大重试次数默认 5，范围 1 到 20 | server.mjs 中 Bso=5，schema 为 min(1).max(20).optional().describe("Max retries per sprint. Default 5 ...")。 |
| partly | alma-missions | sprint-harness 阶段 current_phase 取值为 planning、generating、evaluating、failed | 可见 KG(t.missionId,"planning") 与 KG(t.missionId,"generating",...) 调用，planning 与 generating 已证实；evaluating、failed 未逐一核实。与 alma-features 的 UI 阶段名（Planning/Contracting/Generating/Evaluating/Iterating）不一致，见 conflicts。 |
| confirmed | alma-push | /api/refs/open 只校验 uri，然后 broadcast("reference_open", {uri, threadId}) 并返回 {ok:true}，不写库 | server.mjs 中 post("/api/refs/open") 校验 uri，无效返回 400 valid uri is required，否则 e.broadcast("reference_open",{uri,threadId}) 并 s.json({ok:!0})。 |
| wrong | alma-quote | 可引用对象共 27 种 kind，按顺序列出 date…scratch | renderer/assets/mermaid-NA5CF7SZ-DVyuPqor.js 中 kpt 数组实际为 26 项（date 到 scratch），报告的列表少算一种，应为 26 种。列表本身的顺序与内容与数组一致。 |
| confirmed | alma-quote | 划词弹出长度常量 e1i=3、t1i=2e4，即选区长度在 [3, 20000] | mermaid-NA5CF7SZ-DVyuPqor.js 中可见 e1i=3,t1i=2e4。 |
| confirmed | alma-runtime | Agent 包装器默认 stopWhen 为 stepCountIs(20)（QD(20)），子 agent maxSteps 默认 100（sso=100） | server.mjs 中可见 ...stopWhen)!=null?e:QD(20) 作为默认值，以及 sso=100。 |
| confirmed | alma-runtime | 审批超时默认 RUs=10*6e4，传入超时被上限截断为 DUs=12e4 | server.mjs 中 RUs=10*6e4、DUs=12e4 与报告一致；截断的具体逻辑只确认了常量存在，未逐行核对 MUs。 |
| confirmed | alma-runtime | WebSearch 默认返回 5 条（d=n??5） | server.mjs 中可见 d=n??5。 |
| confirmed | alma-plugins | README 声称 macOS 插件目录为 ~/Library/Application Support/Alma/plugins/，宿主全局插件目录默认 ~/.config/alma/plugins | alma-plugins/README.md 第 220 行为 ~/Library/Application Support/Alma/plugins/；server.mjs 中 globalPluginsPath 默认 join(home,".config","alma","plugins")，可由 ALMA_PLUGINS_DIR 覆盖。两者确实不一致。 |
| partly | alma-plugins | plugin-api HookName 共 11 个钩子，根 README 事件表缺 thread.activated 与 tool.onError | packages/plugin-api/src/index.ts 第 162-173 行 HookName 确为 11 项（含 thread.activated、tool.onError）。README 事件表缺失两项的断言未逐行核对。 |
| confirmed | alma-plugins | tools.register 的类型签名要求 Zod schema（TParams extends z.ZodType） | index.ts 第 108 行 register<TParams extends z.ZodType>(id, definition: ToolDefinition<TParams>)。宿主 zod 与示例 JSON Schema 的矛盾未在本次核实。 |
| confirmed | alma-plugins | alma-plugins 仓库根目录没有 LICENSE 文件，MIT 仅见于 README 与部分 package.json | 在 alma-ref/alma-plugins 下执行 find -iname 'LICENSE*' 无任何结果。 |
| confirmed | alma-plugins | alma-relay 为 MIT，版本 1.3.0，LICENSE 版权为 2025-2026 yetone | alma-relay/LICENSE 首行 MIT License，Copyright (c) 2025-2026 yetone；package.json 中 version 1.3.0、license MIT。 |
| confirmed | alma-plugins | 宿主 register 分支含 case "hrack"，而协议文档只定义 agent 发送的 hack，relay 未定义 hrack 帧 | server.mjs 中可见 case"hrack" 分支与 t:"hack" 的发送；alma-relay/index.mjs 第 739 行处理 case 'hack'，PROTOCOL.md 第 93 行仅定义 agent→relay 的 hack，未见 hrack。该分支的可达性是推断，报告的推断语气合理。 |
| confirmed | alma-features | Sprint Harness 阶段名为 Planning、Contracting、Generating、Evaluating、Iterating | renderer/assets/generative-ui-block-DMz6ESia.js 中可见 "Planning"、"Contracting"、"Iterating" 等 UI 文案，与报告一致；但它与 alma-missions 的服务端阶段集合不同，见 conflicts。 |

题目之间的矛盾：

- 版本号：alma-threads 称 Alma 版本无法确定（Info.plist 无 CFBundleShortVersionString），但 alma-subagents、alma-runtime、alma-plugins、alma-missions、alma-features 均据 Info.plist 与 alma-server/VERSION 得出 0.4.509。以 0.4.509 为准，alma-threads 的版本结论应更正。
- sprint-harness 阶段集合不一致：alma-missions 据服务端 kT/KG 调用归纳为 planning、generating、evaluating、failed；alma-features 据 UI 文案归纳为 Planning、Contracting、Generating、Evaluating、Iterating。两者都未覆盖对方的全部阶段（Contracting、Iterating 未在服务端调用中出现）。需以服务端状态机为准，UI 文案可能是派生展示。
- 插件目录：alma-plugins 的 README 写 macOS 为 ~/Library/Application Support/Alma/plugins/，而宿主代码默认 ~/.config/alma/plugins（可由 ALMA_PLUGINS_DIR 覆盖）。同一仓库 README 还列 Linux 为 ~/.config/Alma/plugins/，与宿主默认值也不一致。
- 计数不一致：alma-quote 称可引用 kind 为 27 种，但其自己列出的数组实际为 26 项。
- 工具参数类型：alma-plugins 报告指出 plugin-api 类型要求 Zod，而 hello-world 示例与 plugin-api README 使用 JSON Schema，三处互相矛盾。

原始事实引用了 Alma 闭源 bundle 的代码片段，不入库，只存本地 `~/Projects/alma-ref/notes/facts-B3.md`。
