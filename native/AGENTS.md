# native/

Go rewrite of attention. RFC: `docs/rfc/0001-go-native-plugin-browser.md`. Roadmap: `docs/roadmap.md`. Spike: `docs/rfc/0001-spike-report.md`.

The repo-root `AGENTS.md` / `CLAUDE.md` rule “reconstruct Obsidian byte-for-byte” does **not** apply here.

## Behaviour and UI

- Port behaviour from the TS app in `apps/web`. Cite the TS file in a comment.
- Never call `.Key()` on the element an `omgui.Button` / `IconMenu` returns: it rekeys the control and its `OnClick` never runs or its menu never opens. Key the parent, or use `.Clicked()` on a plain element.
- Look comes from [attention-ui](https://github.com/cunninghamcard-bit/attention-ui) (octogo’s components). Follow octogo’s `docs/STYLE.md` (`octogo/docs/STYLE.md`): no literal colours or sizes in pages; use theme tokens and omgui components.

## Threading

- UI state only on the mygo main thread.
- Work done on goroutines comes back through `shellapi.Update`.
- Never do disk or service calls in a View function.
- `shellapi.OnMain` must not be called from the main thread.

## rutis plugins

- UI plugins contribute through `slotsapi` (dock panels, ribbon) and reach the workspace through `workspaceapi`; they inject `workspace` so rutis orders them after it. Opening goes through `OpenResource(address, opts)` (`Open(path)` for a path); a bad address or a `Kind` that won't open it is an error and makes no tab.
- Viewers are tab types (`tabtypesapi`, RFC §5.6): a pattern over resource addresses (`fscontract.AddressFor` / `AbsoluteAddress`), a tier, a `Body` keyed by the type's ID. Tab identity is `(kind, address)`. As in dsh's registry: an ID registers once, a kind holds at most a Builtin and an Extension (the Extension in force, a Fallback alone), an unnamed `Priority` is Extension; breaking these panics. Panel and ribbon IDs register once too. They don't inject `workspace`: the workspace reclaims its tabs whenever the registry's generation changes.
- A tab holds its address in `resourcesapi` while open; `fileresource` serves the `file` protocol (stat + watch of the parent directory). A viewer keeps per-tab state by `Info.ID`, drops it in `Closed` (called when the tab closes or moves to another type, even one unloaded), waits while `Info.Pending`, and reads its file when `Info.Version` moves. It never subscribes to fs changes; `Info.Missing` comes from the resource's state.
- Constructors take a `post func(func())` (`shellapi.Update` in the plugin): tests pass a channel, since `shellapi.Update` holds posts until a window exists.

- Every `ctx.Go` task must return when its context is cancelled (unload waits for it before Effects run).
- Register, then hand the off func to `ctx.Effect`.
- Service contract methods end in error.
- No channels in contracts.

## Processes

- The UI runtime ignores SIGPIPE.
- Never send rutis-host a second signal (it skips cleanups).
- Exit-path table: `docs/rfc/0001-spike-report.md`.

## Font

- Body font follows the system (fontconfig sans-serif). Do not “fix” it in the theme.

## Verify

```
cd native && gofmt -l . && go vet ./... && go test ./...
```

GUI tests use mygo’s `ui.NewTester` in-process. Never send synthetic keystrokes to the real desktop — the user works on this machine.

## Commits

Conventional, lowercase subject (commitlint).
