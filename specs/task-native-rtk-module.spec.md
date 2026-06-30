spec: task
name: "Native RTK Module"
inherits: project
tags: [phase-3, rtk, native-extension, parity]
---

## Intent

Port the useful behavior of `MasuRii/pi-rtk-optimizer` into Attention as a
native Go module. The module should rewrite eligible bash commands through the
installed `rtk` binary, compact noisy tool output before it enters context, and
expose text-only `/rtk` commands through the generic command protocol.

## Decisions

- Add the module under `internal/rtk`.
- Register it from `cmd/along` as an `extension.Factory`.
- Use config path `<agentDir>/extensions/pi-rtk-optimizer/config.json`.
- Default config mirrors upstream `pi-rtk-optimizer` at commit `78b8f8a08e5564072eb73e2fa9f183c9f03d2625`.
- RTK rewrite rules stay external: call `rtk rewrite <command>`.
- Resolve RTK with `where rtk` on Windows and `which rtk` elsewhere, then verify with `rtk --version`.
- Cache runtime status for 30 seconds.
- Rewrite mode prepends `RTK_DB_PATH` under the temp `pi-rtk-optimizer/history.db` path unless the command already sets it.
- Suggest mode reports suggestions without mutating the command.
- Register `/rtk help`, `/rtk show`, `/rtk path`, `/rtk verify`, `/rtk stats`, `/rtk clear-stats`, `/rtk reset`, and `/rtk set <path> <value>`.
- `/rtk set` supports every default config field through an allowlist and writes atomically after full config normalization.
- Do not port the Pi modal, Zellij modal, or `pi-tui` settings UI.

## Boundaries

### Allowed Changes
- internal/rtk/**
- cmd/along/**
- internal/hook/**
- internal/extension/**
- internal/orchestrator/**
- internal/tool/**
- internal/execenv/**

### Forbidden
- Do not add a TypeScript/npm extension runtime.
- Do not hardcode RTK behavior in cmd/tui.
- Do not duplicate RTK's rewrite rule database in Go.
- Do not require the `rtk` binary for Attention startup.
- Do not add new dependencies when existing packages or stdlib are enough.

### Out of Scope
- Interactive RTK settings UI.
- Replacing RTK's own rewrite engine.
- Product changes to model switching, chat mode, or unrelated TUI behavior.

## Completion Criteria

Scenario: default config is created and normalized
  Test: TestRTKConfigEnsureLoadAndNormalizeDefaults
  Given no RTK config file exists under the agent dir
  When the native RTK module initializes its config
  Then it writes the upstream-compatible default config
  And loading that file returns normalized values

Scenario: native module registers through along extension sources
  Test: TestAlongRegistersNativeRTKExtensionFactory
  Given Attention starts with the default built-in extension set
  When `cmd/along` assembles orchestrator options
  Then the RTK module is registered as an `extension.Factory`
  And the registration does not require the `rtk` binary to exist

Scenario: invalid config degrades without clobbering
  Test: TestRTKConfigInvalidJSONFallsBackWithoutOverwrite
  Given the RTK config file contains invalid JSON
  When the module loads config
  Then defaults are used in memory
  And the invalid file is not overwritten
  And a warning is available to the command or hook path

Scenario: missing RTK guard leaves command unchanged
  Test: TestRTKRewriteGuardSkipsWhenBinaryMissing
  Given config enables rewrite mode and `guardWhenRtkMissing`
  And RTK runtime verification fails
  When a bash `tool_call` asks to run `git status`
  Then the command remains `git status`
  And no `rtk rewrite` probe runs for that command

Scenario: rewrite applies RTK command and environment
  Test: TestRTKRewriteAppliesResolvedCommandAndDBPath
  Given RTK is available
  And `rtk rewrite "git status"` returns `rtk git status`
  When the bash `tool_call` is processed
  Then the command is changed to include `rtk git status`
  And the command includes an exported `RTK_DB_PATH`

Scenario: already-RTK command is not rewritten
  Test: TestRTKRewriteSkipsAlreadyRTKCommand
  Given RTK is available
  When the bash `tool_call` command is `RTK_DB_PATH=/custom rtk git status`
  Then no rewrite command is executed
  And the original command remains unchanged

Scenario: ripgrep rewrite preserves rtk rg proxy
  Test: TestRTKRewriteNormalizesRipgrepProxy
  Given RTK rewrite returns `rtk grep foo`
  And the original command starts with `rg foo`
  When rewrite normalization runs
  Then the final command uses `rtk rg foo`
  And it does not use `rtk grep foo`

Scenario: bash tool result compaction strips RTK noise
  Test: TestRTKBashToolResultCompactionStripsWarningsAndRecordsMetadata
  Given a bash tool result contains ANSI escapes and known RTK hook warnings
  When the `tool_result` hook runs
  Then the returned text removes the known RTK hook warning
  And compaction metadata is stored under `rtkCompaction`
  And compaction metadata is also stored under `metadata.rtkCompaction`

Scenario: default read output remains exact
  Test: TestRTKReadResultExactByDefault
  Given default config has read compaction disabled
  When a read tool result contains source text
  Then the returned text is byte-for-byte unchanged
  And no lossy source filtering is applied

Scenario: streaming sanitizer mutates partial bash output
  Test: TestRTKStreamingSanitizerMutatesPartialBashOutput
  Given Phase 1 mutable tool execution events are available
  And a bash partial result contains RTK emoji output and hook warnings
  When `tool_execution_update` runs through RTK
  Then the mutated partial result uses plain text markers
  And known RTK hook warnings are removed before RPC/TUI publication

Scenario: rtk verify command reports runtime status
  Test: TestRTKVerifyCommandNotifiesRuntimeStatus
  Given Phase 2 command notifications are available
  When `/rtk verify` is dispatched
  Then the command notification reports whether RTK is available
  And the notification includes the resolved RTK executable path when available

Scenario: rtk set rejects invalid config path
  Test: TestRTKSetCommandRejectsInvalidPath
  Given the user dispatches `/rtk set unknown.path on`
  When the RTK command handler runs
  Then it sends a warning-level command notification
  And the config file is not changed

Scenario: rtk stats and clear-stats use in-memory metrics
  Test: TestRTKStatsAndClearStatsCommandsUseMetrics
  Given RTK compaction has tracked saved characters
  When `/rtk stats` is dispatched
  Then the command notification reports saved character counts
  When `/rtk clear-stats` is dispatched
  Then later `/rtk stats` reports no data
