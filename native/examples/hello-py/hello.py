"""A third-party attention plugin in Python (RFC 0001 §5.11).

It registers the `hello` command through attention's `actions` service,
which every process may use: no rebuild of attention. Install it by adding
its runtime and row to plugins.json in attention's configuration folder:

    {
      "runtimes": {"py": {"project": "<this folder>", "python": "<venv>/bin/python"}},
      "rows": [{"id": "hello-py", "name": "py:hello"}]
    }

with a virtual environment holding the rutis runtime of rutis-host's
version (`uv venv && uv pip install "rutis==0.17.1"`). Then
`attention hello name=Ada` answers from here.
"""

inject = ["actions"]


async def apply(ctx, config):
    actions = ctx.use("actions")

    def hello(*args):
        # The CLI's parameters, then its working folder.
        params = args[-2] if len(args) >= 2 else {}
        name = (params or {}).get("name") or "world"
        return f"Hello, {name}! (from Python)"

    await actions.register({"id": "hello", "title": "Say hello", "cli": True, "flags": []}, hello)

    async def cleanup():
        try:
            await actions.unregister("hello")
        except Exception:
            pass  # attention stopping: its actions dropped the command already

    return cleanup
