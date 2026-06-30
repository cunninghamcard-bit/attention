spec: project
name: "Attention Pi-Compatible Runtime"
tags: [attention, pi-compatible, runtime]
---

## Intent

Keep Attention's Go kernel compatible with Pi's observable runtime contracts
while preserving the existing TUI/RPC split. Project work should prefer native
Go modules and generic protocols over feature-specific TUI branches.

## Constraints

- Kernel behavior must remain driven by orchestrator, harness, hook, extension, tool, and RPC contracts rather than TUI special cases.
- Slash-command completion data must continue to come from the kernel `get_commands` response.
- Tool lifecycle events exposed to RPC/TUI must match the final kernel event state after hooks have run.
- New native modules must degrade safely when optional external binaries are missing.
- Do not add a TypeScript/npm extension runtime unless a separate contract explicitly asks for it.
- Do not add new dependencies for behavior already covered by existing packages or the Go standard library.

## Decisions

- Attention remains a Go implementation with Pi-compatible event, session, tool, resource, and RPC shapes.
- The TUI remains a client of the RPC protocol; it must not know RTK-specific behavior.
- Native extensions should use the existing `extension.Factory` and `hook.Registry` path.

## Completion Criteria

Scenario: kernel command list remains the slash-command source
  Test: TestSlashCommandsRemainKernelDriven
  Given the kernel returns builtin, prompt, skill, and extension commands
  When the TUI builds slash-command completion candidates
  Then the candidates come from `get_commands`
  And the TUI does not maintain a separate RTK command list

Scenario: mutated lifecycle events reach RPC and TUI
  Test: TestToolLifecyclePublishesFinalMutatedState
  Given a native hook mutates a tool lifecycle event before publication
  When the orchestrator publishes the event to subscribers
  Then RPC receives the final mutated event state
  And TUI rendering receives the final mutated event state

Scenario: optional RTK binary absence does not break startup
  Test: TestNativeModuleMissingExternalBinaryDoesNotBreakStartup
  Given the native RTK module is registered
  And the `rtk` binary is not available
  When Attention starts a session
  Then startup succeeds
  And bash commands can still execute without RTK rewriting

Scenario: RTK behavior stays out of TUI dispatch
  Test: TestNoRTKSpecificTUICommandDispatch
  Given the TUI dispatches a command with source "extension"
  When the command name is "rtk"
  Then the TUI uses the generic extension command RPC path
  And no RTK-specific branch is required

Scenario: TypeScript extension runtime is not introduced
  Test: TestNativeRTKDoesNotAddTypeScriptExtensionRuntime
  Given the native RTK module is enabled
  When the runtime loads extensions
  Then it uses Go `extension.Factory` registration
  And it does not execute npm or TypeScript extension loaders

Scenario: new dependency is rejected when existing code suffices
  Test: TestRTKIntegrationAvoidsUnneededDependencies
  Given the RTK integration needs shell quoting, config parsing, and command execution
  When implementation code is reviewed
  Then existing repository packages or Go standard library APIs provide those behaviors
  And no new dependency is added for them
