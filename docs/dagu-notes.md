# dagu 阅读指南

克隆在 `~/Projects/dagu`(github.com/dagucloud/dagu,Go 单二进制 DAG
编排器)。这份是给人读代码用的路线图;机器抽取的结论已经落在 loom 的
`GRAPH.md`(三面模型、dispatch.after 提案、反教训清单),两边互不重复。

## 带着三个问题读

1. **一条依赖边到底要携带多少语义?** 我们的答案是两列
   (`after_dispatch_id` + `release_on`),它的答案是五旋钮
   `ContinueOn` —— 读完 `isReady` 再判断谁对(提示:取决于节点是
   shell 命令还是 agent 回合)。
2. **release(前置满足了吗)和 admission(容量允许吗)分开,分到
   什么程度才算够?** 它分到了两个进程。我们只需要分到两个函数吗?
3. **它把哪些东西做成了 schema,而我们决定留给政策层?** 每见到一个
   YAML 字段,问一句"loom 里这是谁的事"。

## 阅读顺序(六站)

**第 1 站:`internal/core/step.go`(节点的全部词汇,~500 行)**
一个 Step 能声明什么:`Depends`(:76)、`ContinueOn`(:80,
:407-413 —— Failure/Skipped/ExitCode/Output/MarkSuccess 五旋钮)、
`RetryPolicy`(:82)与 `RepeatPolicy`(:84,注意 repeat 是节点内
循环,不是图边)、`Preconditions`(:88,shell 条件门,和 Depends
正交)、`SubDAG`(:92)、`Approval`(:418-428,人肉门 + RewindTo
回退重跑)、`Router`(:450-460,唯一真正的条件边)。
看点:它把"门"分了四种(依赖/条件/人肉/路由)而且互不混淆 ——
这个分类本身比任何一种实现都值钱。

**第 2 站:`internal/runtime/plan.go`(步骤怎么变成图)**
`buildEdges`(:182-197)把 `Depends` 字符串编译成邻接表;
`isCyclic`(:231-260,Kahn)在跑任何节点之前拒环 —— 写时验证,
运行时死锁检测只是兜底。真正的宝藏是 `setupRetry`(:263-313):
重跑只重放"坏掉的子图及其下游",从持久化的节点状态反向重建计划
(`CreateRetryPlan` :69-102)。我们的 seq 事件日志天然支持同款回放,
值得对着想。

**第 3 站:`internal/runtime/runner.go`(整个仓库最重要的一个函数)**
事件循环(:132-408):readyCh/doneCh、并发上限、显式死锁检测
(:229-233)。然后精读 **`isReady`(:1008-1080)** —— 依赖释放是
对上游终态的完整 switch:Succeeded 放行、Failed 看 ContinueOn、
Skipped 分来源、Aborted 永远传播。"released on success"只是默认值,
每种失败模式都可配置渗透。这就是 GRAPH.md 里"边必须带 release
条件"的出处。

**第 4 站:`internal/core/dag.go`(读前 300 行,当反面教材)**
DAG 结构 ~60 个字段:SMTP、S3、k8s、OTel、secrets、webhook……
这是"编排即产品"走到头的样子。值得认真读的只有:`HandlerOn`
(:1063-1070,六种生命周期钩子)、`OverlapPolicy`(:113-115,
新触发撞上在跑实例时 skip/all/latest —— 我们的 pending 唯一索引
就是硬编码的 skip)、`Queue` 与已废弃的 MaxActiveRuns(:190-191,
准入归队列不归 DAG)。

**第 5 站:`internal/persis/file/dagrun/attempt.go`(持久化对照组)**
每次状态变化追加一份**全量快照**,然后需要 compaction(:36
ErrCompactFailed)。对照我们的选择:seq 追加事件 + 回放,不需要
第二种历史格式。还有 `repairStaleLocalRunIfDead`(manager.go
:450-521):进程死了但状态文件还写着 Running 时的修复 —— 和我们的
Reconcile 是同一个问题的两种解法。

**第 6 站:`internal/service/scheduler/`(略读,看边界)**
cron 解析、TickPlanner、QueueProcessor —— 完整独立的进程。看点
只有一个:release 和 admission 真的是两个子系统。然后合上,提醒
自己这整个目录在 loom 里是政策层的一个定时器循环。

## Worker 统一专线

`internal/runtime/executor/executor.go:34` 的 `Executor` 接口 ——
对照我们的 `engine.Engine`。它的执行器:shell/docker/ssh/sub-DAG/
HTTP/**LLM chat**;我们的:claude/codex/pi。同一个手法,不同的
智能位置。顺着看 `internal/llm` 和 `internal/runtime/agent`:
**dagu 正在把 agent 塞进 DAG 的一步,而我们把 DAG 当作 agent 的
一种活动** —— 在它的代码里亲眼看到这个包含关系,比任何论述都直观。

## 跳过

`tunnel/ license/ incident/ gitsync/ notification/ remotenode/
upgrade/ auth/` —— 企业分发面,与内核设计无关。testdata 里的 YAML
示例倒值得翻几个,那是它的"用户语言"。

## core 的规范手法(第二次深读,2026-07-05)

它 26k 行 schema 不散架靠的是纪律,不是天赋。十一条,行号皆核实:

1. **分层单向依赖**:`core`(纯类型+注册表)← `core/spec`(YAML authoring)← runtime。core 不 import 任何上层;执行器向 core 的注册表登记,而非 core 认识执行器。对应 loom:event=词汇层、store=schema 层、api=最外层,**api 永远不长契约逻辑**。
2. **枚举钉死**:NodeStatus 数值固定并写明兼容注释(status.go:68-69"persisted... older files depend on the historical encoding");显示串永不入库,由 String() 派生(:102-128),Parse 配对同文件;IsActive/IsDone 等谓词长在类型上,调用方永不裸比。
3. **spec/runtime 分离**:YAML 中间表示(spec/dag.go:38-40)经 loader→builder→applyDefaults 单向流水线变成 runtime 类型;raw 形状永不过界。
4. **一个时长解析器**(duration.go:14-43,扩展 'd' 天单位):人类文本只在入口出现,内部只有 time.Duration。
5. **插件自带校验与能力**:RegisterExecutor(factory, validator, capabilities)(executor.go:66-75)反向注册进 core 的注册表(validator.go:66-70, capabilities.go:74-76);未注册默认全 false 严格模式。
6. **默认值一处声明**(spec/defaults.go:14-23)、一处应用(builder.go:456),且按 **YAML key 在场性**而非 Go 零值判断"没写 vs 显式零"(defaults.go:50-55)。
7. **弃用即文档化容忍**:MaxActiveRuns 继续解析但注释指向 Queue(dag.go:180-183);14 条弃用字段有替换表(deprecation.go:21-36),警告只在 validate 路径发,运行时静默兼容。
8. **机器可读 schema 随二进制发布**:schemas/dag.schema.json(draft-07,additionalProperties:false)go:embed 进二进制(cmn/schema/schema.go:9),编辑器补全和运行时校验同源。
9. **错误分类学**:每层一个 errors.go 放哨兵(core 38 个),唯一的类型化错误 ValidationError{Field,Value,Err}(errors.go:90-114),ErrorList 实现 Unwrap() []error 让 errors.Is 跨层。
10. **整图校验一次收集全部错误**(validator.go:80-99):作者一次看到所有问题,而不是修一个爆一个。
11. **YAML 多态圈进联合类型**(types.StringOrArray 等 + 共享 DecodeHook + ErrorUnused:true 拒未知键):灵活性止步于解码层。

**反模式六条**(全是 60 字段 god struct 的并发症):领域结构体兼职 wire 格式、靠 `json:"-"` 当唯一防泄密线(8 处,漏一个 tag = 泄凭据);SSH/S3/LLM/k8s 配置长进通用契约(与自己的 capability 注册表自相矛盾);raw bytes 和 sync.Once 混进"纯"schema 类型;WorkingDirExplicit 这类 twin 字段找补扁平化丢失的信息;typed 枚举与裸 string 枚举并存;~50 条改名别名表永久背着——扁平命名空间的税。
