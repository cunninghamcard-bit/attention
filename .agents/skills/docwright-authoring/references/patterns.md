# Authoring Patterns Reference

> Tracks docwright 0.3.0 (BDD-spine). See the "BDD-spine Patterns (0.3.0)"
> section below for Rule→Example, `## Questions`, lint-ack, and capability specs.

## Spec Frontmatter

```yaml
spec: task           # org | project | capability | task
name: "Task Name"   # Required, human-readable
inherits: project    # Optional, parent spec name
tags: [tag1, tag2]   # Optional, for filtering
capability: auth     # Optional (0.3.0): the capability this task contributes a Rule to
```

## Section Headers

Structural keywords are English-only (as of docwright 0.4.0). CJK keywords are rejected with an error naming the English replacement. Free text (titles, prose, quoted params) may be any language.

| Section | Header |
|---------|--------|
| Intent | `## Intent` |
| Constraints | `## Constraints` |
| Decisions | `## Decisions` |
| Boundaries | `## Boundaries` |
| Acceptance Criteria | `## Acceptance Criteria` / `## Completion Criteria` |
| Out of Scope | `## Out of Scope` |

## Invalid Near-Misses

These look plausible to a general-purpose LLM, but should not be emitted:

```spec
## Intent / 意图
## 完成条件
## Milestones
## Quality
## Architecture
```

Use only the supported English top-level sections.

## Parser Accepts But Authoring Should Avoid By Default

The parser accepts these compatibility forms, but the authoring style should still prefer bare DSL lines:

```spec
### Scenario: Happy path
### Test: test_happy_path
```

Prefer:

```spec
Scenario: Happy path
  Test: test_happy_path
```

## Rewrite / Parity Checklist

For rewrite, migration, and parity contracts, start from observable behavior, not modules.

Check whether the spec covers:

- command x output mode
- local x remote
- warm cache x cold start
- success x partial failure x hard failure
- CLI x MCP entry points when both are public

If these dimensions matter and are only mentioned in Decisions, the contract is not ready yet.

## Complete Task Contract Example

```spec
spec: task
name: "用户注册API"
inherits: project
tags: [api, auth]
---

## Intent

为现有的认证模块添加用户注册 endpoint。新用户通过邮箱+密码注册，
注册成功后发送验证邮件。这是用户体系的第一步，后续会在此基础上
添加登录和密码重置。

## Decisions

- 路由: POST /api/v1/auth/register
- 密码哈希: bcrypt, cost factor = 12
- 验证 Token: crypto.randomUUID(), 存数据库, 24h 过期
- 邮件: 使用现有 EmailService，不新建

## Boundaries

### Allowed Changes
- crates/api/src/auth/**
- crates/api/tests/auth/**
- migrations/

### Forbidden
- 不要添加新的 npm/cargo 依赖
- 不要修改现有的登录 endpoint
- 不要在注册流程中创建 session

## Acceptance Criteria

Scenario: 注册成功
  Test: test_register_returns_201_for_new_user
  Given 不存在邮箱为 "alice@example.com" 的用户
  When 客户端提交注册请求:
    | 字段     | 值                |
    | email    | alice@example.com |
    | password | Str0ng!Pass#2026  |
  Then 响应状态码为 201
  And 响应体包含 "user_id"
  And EmailService.sendVerification 被调用

Scenario: 重复邮箱被拒绝
  Test: test_register_rejects_duplicate_email
  Given 已存在邮箱为 "alice@example.com" 的用户
  When 客户端提交相同邮箱的注册请求
  Then 响应状态码为 409

Scenario: 弱密码被拒绝
  Test: test_register_rejects_weak_password
  Given 不存在邮箱为 "bob@example.com" 的用户
  When 客户端提交密码为 "123" 的注册请求
  Then 响应状态码为 400
  And 响应体包含密码强度要求

Scenario: 缺少必填字段
  Test: test_register_rejects_missing_fields
  When 客户端提交缺少 email 字段的注册请求
  Then 响应状态码为 400

## Out of Scope

- 登录功能
- 密码重置
- OAuth 第三方登录
```

**Note**: 1 happy path + 3 exception paths. Exception scenarios >= happy path is the core authoring principle.

## Rewrite / Parity Example

See [`examples/rewrite-parity-contract.spec`](../../../examples/rewrite-parity-contract.spec) for a compatibility-oriented contract that binds output modes, cache state, source type, and failure paths.

## Mandatory Validation

After drafting a spec, run:

```bash
docwright parse docs/features/<goal>/spec.md
docwright lint docs/features/<goal>/spec.md --min-score 0.7
```

If `parse` reports `0 scenarios`, the spec is not ready for `contract`, `lifecycle`, or `guard`.

## Boundary Sub-Headers

```spec
## Boundaries

### Allowed Changes
- crates/spec-parser/**
- tests/parser_contract.rs

### Forbidden
- Do not change the public API shape
- crates/spec-core/src/ast.rs

### Out of Scope
- Authentication system
```

Category keywords recognized:
- Allowed: `allowed`, `allow`
- Forbidden: `forbidden`, `forbid`, `deny`
- Out of Scope: `out of scope`, `scope`

## Scenario Patterns

### Simple test selector

```spec
Scenario: Happy path
  Test: test_happy_path
  Given precondition
  When action
  Then result
```

Free text stays language-neutral — only the keywords are English:

```spec
Scenario: 正常路径
  Test: test_happy_path
  Given 前置条件
  When 执行操作
  Then 预期结果
```

### Structured test selector

```spec
Scenario: Cross-crate verification
  Test:
    Package: spec-gateway
    Filter: test_contract_prompt_format
  Given a task spec
  When verified
  Then passes
```

### Step tables

```spec
Scenario: Batch processing
  Test: test_batch_processing
  Given the following records:
    | id  | name  | status  |
    | 1   | Alice | active  |
    | 2   | Bob   | pending |
  When the processor runs
  Then "2" records are processed
```

## Step Keywords

| Keyword | Type |
|---------|------|
| Given | Precondition |
| When | Action |
| Then | Assertion |
| And | Continue previous |
| But | Negative continue |

## Parameters

Quoted strings are extracted as parameters:

```spec
Given 存在一笔金额为 "100.00" 元的交易 "TXN-001"
```

Extracts: `["100.00", "TXN-001"]`

Both ASCII quotes `"..."` and Chinese quotes `\u{201C}...\u{201D}` are supported.

## SDD Goal Package

For substantial work, `docwright-sdd` invokes:

```bash
docwright init --kind feature --name "Plugins Hub"
```

The generated `spec.md` is authoritative; `plan.md` describes implementation
and `tasks.md` tracks execution. Keep PlantUML inside Markdown fences and bind
observable BDD behavior to public E2E tests whenever practical.

## Three-Layer Inheritance Example

### org.spec.md

```spec
spec: org
name: "ACME Corp Standards"
---

## Constraints

- All public APIs must have integration tests
- No .unwrap() in production code
```

### project.spec.md

```spec
spec: project
name: "Payment Gateway"
inherits: org
---

## Constraints

- All monetary amounts use Decimal type
- Response time under 500ms for payment endpoints

## Decisions

- Use PostgreSQL for transaction storage
- Use Redis for session caching
```

### task.spec.md

```spec
spec: task
name: "Add Refund API"
inherits: project
tags: [payment, refund]
---

## Intent

Add refund endpoint to the payment gateway.

## Completion Criteria

Scenario: Full refund
  Test: test_full_refund
  Given a completed transaction "TXN-001" for "100.00"
  When a full refund is requested
  Then the refund status is "processing"
```

The task spec inherits constraints from both project and org.

## Lint Rules and Fixes

| Rule | Trigger | Fix |
|------|---------|-----|
| `vague-verb` | "handle", "manage", "process", "处理", "管理" | Use specific verbs: "validate", "persist", "计算" |
| `unquantified` | "fast", "efficient", "应该快速" | Add numbers: "within 200ms", "200ms 内" |
| `testability` | Non-observable assertions | Use "returns X", "status becomes Y" |
| `coverage` | Constraint without matching scenario | Add scenario exercising the constraint |
| `determinism` | "should", "might", "may" in steps | Use definitive: "returns", "is", "becomes" |
| `implicit-dep` | Scenario missing `Test:` selector | Add `Test: test_name` line |
| `explicit-test-binding` | Scenario without test binding | Add `Test:` or structured selector |
| `sycophancy` | "find all bugs", "找出所有" | Remove bias language, state neutral criteria |

## Quality Score

The quality score (0.0 - 1.0) is computed from three dimensions:

- **Determinism**: Penalty for non-deterministic step wording
- **Testability**: Penalty for untestable steps
- **Coverage**: Ratio of constraints with covering scenarios

Default minimum score for `lifecycle` and `guard`: `0.6`

## Time Comparison

```
Traditional:  Write Issue 5min + Read diff 30min + Comment 15min + Re-review 15min = ~65min
docwright:   Write Contract 15min + Read explain 5min + Approve 2min = ~22min
```

## BDD-spine Patterns (0.3.0)

### Rule → Example grouping

```spec
## Completion Criteria

### Rule: reject-invalid-input — 拒绝非法输入
Scenario: 空邮箱被拒绝
  Test: test_rejects_empty_email
  When 提交空邮箱
  Then 返回 400

Scenario: 弱密码被拒绝
  Test: test_rejects_weak_password
  When 提交密码 "123"
  Then 返回 400
```

- Rule id = leading kebab-case token (`reject-invalid-input`); separated from the mutable display name by an em dash `—` or two-or-more spaces (a plain `--` is NOT a recognized separator — it gets swallowed into the id and trips `bdd-rule-id`).
- `Example:` is a synonym for `Scenario:`.
- Identity lives in the id, never the display name. Lints: `bdd-rule-id` (malformed id), `bdd-rule-grouping` (ungrouped scenarios).

### Discovery questions (non-blocking)

```spec
## Questions

- 折扣能否叠加?
- [x] 退款按折后价(已确认)
```

- Header: `## Questions`. Resolved markers: `[x]`, `RESOLVED`.
- `open-question` lint is Info/Warning only — never affects `is_passing`.

### lint-ack (acknowledge a warning with a reason)

```spec
<!-- lint-ack: error-path — 本任务是只读查询,无失败路径 -->
```

- Format: `<!-- lint-ack: <code> — <reason> -->`. The code and reason must be separated by an em dash `—` or a colon `:`; without one the whole string is read as the code and nothing is acknowledged.
- Filters that Warning/Info from the report but keeps it counted (visible in `audit`). Reason is mandatory.
- Errors can NEVER be acknowledged — only Warning/Info.

### Capability spec (living-spec library)

```spec
spec: capability
name: "认证能力"
---

## Completion Criteria

### Rule: reject-invalid-input — 拒绝非法输入
（promoted from task; id preserved）
```

- Created/extended by `docwright promote <task> --rule <id> --to <cap> --code .` (writes `docs/capabilities/<cap>.spec.md`).
- Promote gate: the Rule's Examples must pass, ≥1 example required. The `id` is preserved across the lift.

### Reverse-engineer a draft from tests (cold start)

```bash
docwright discover --from-codebase --code src --name "drafted from tests" --out docs/features/drafted/spec.md
```

Produces one `Test:`-bound scenario per test fn + a `## Questions` seed. The draft is parseable but NOT a finished contract — refine intent and the seeded questions.

The 15 minutes spent writing a Contract is higher-value than the 30 minutes spent reading a diff, because you're defining "what is correct" instead of guessing "is this code correct".

## Report Mode Contract Example (TypeScript / vitest)

```spec
spec: task
name: "User registration status codes"
test_command: pnpm vitest run -t "{selectors}" --reporter=junit --outputFile=.docwright/report.xml
test_report: .docwright/report.xml
---

## Intent

Return deterministic status codes for new-user and duplicate-email
registration, verified through the project's own vitest suite.

## Decisions

- New user returns status `201`
- Duplicate email returns status `409`

## Boundaries

### Allowed Changes
- src/**

## Completion Criteria

Scenario: New user gets 201
  Test: returns 201 for a new user
  Given no user with email "alice@example.com" exists
  When the client registers "alice@example.com"
  Then the returned status is 201

Scenario: Duplicate email gets 409
  Test: rejects duplicate email with 409
  Given a user with email "alice@example.com" exists
  When the client registers "alice@example.com" again
  Then the returned status is 409
```

The selector is the vitest `it` title; the report testcase name
`registration > rejects duplicate email with 409` matches by suffix.
