# Third-party plugins

attention takes a third party's plugin in three ways (RFC 0001 §5.11).

## A service plugin, any language, no rebuild

rutis-host runs plugins in Go, TypeScript, Python, Swift and more. Add the
plugin's runtime and row to `plugins.json` in attention's configuration
folder (`$ATTENTION_CONFIG_DIR`, else `~/.config/attention`). Every launch
merges them into the run's `rutis.json`:

```json
{
  "runtimes": {
    "py": { "project": "/path/to/native/examples/hello-py", "python": "/path/to/.venv/bin/python" }
  },
  "rows": [
    { "id": "hello-py", "name": "py:hello" },
    { "id": "hello-panel", "name": "py:hello_panel" }
  ]
}
```

The Python environment holds the rutis runtime of rutis-host's version:

```sh
uv venv /path/to/.venv
uv pip install --python /path/to/.venv/bin/python "rutis==0.17.1"
```

A plugin reaches attention through its services. Their methods' wire
names are lowerCamel:

- `actions`: `register(command, run)` adds a command to the palette and
  the CLI. `command` is `{id, title, keys, cli, flags}`. `run(params, cwd)`
  is called across the process and returns the command's output. `params`
  holds the CLI's `key=value` pairs; a bare flag's value is `"true"`.
  `unregister(id)` removes it. See `hello-py/hello.py`; then
  `attention hello name=Ada`.
- `webview-panels`: `register({id, title, dock, url | html, icon})` shows
  a dock panel in a web view. `unregister(id)` removes it. See
  `hello-py/hello_panel.py`.

A Go service binary joins rutis's Go runtime: put its path in
`runtimes.go.binaries` in `plugins.json`, and its rows beside the others.

## A native UI plugin: `attention build --with`

Go loads no code at run time, so a native UI plugin is compiled in. Its
module exports `var Plugin = rutis.Define(...)`, which `attention build`
passes to `app.Main`. It may inject any in-process service (`shell`,
`slots`, `tabTypes`, `workspace`, `actions`, …) via `rctx.Use`. Then:

```sh
attention build --with example.com/attention-hello-ui=./examples/hello-ui -o ./attention-hello
```

The flag is `--with <module>[@version][=local folder]` and repeats.
`--source` names attention's `native/` folder; the default is
`$ATTENTION_SOURCE`, else the folder above the binary. The build needs the
Go toolchain. `hello-ui/` adds a Hello panel to the left dock and the
`hello-ui:open` command.

## A web UI: webview-panel-ui

A plugin that has HTML rather than native UI registers it with
`webview-panels` (above). It shows as a window set into attention's, not
native UI.
