"""A third party's UI in Python, through attention's webview-panel-ui
(RFC 0001 §5.11): a panel of HTML in the right dock, a window set into
attention's, not its native UI. Its row, beside hello's in plugins.json:

    {"id": "hello-panel", "name": "py:hello_panel"}
"""

inject = ["webview-panels"]

HTML = """<!doctype html>
<meta charset="utf-8">
<style>body{font:14px system-ui;margin:16px;color:#444}</style>
<h3>Hello from Python</h3>
<p>This panel is HTML a Python plugin handed to attention.</p>
<button onclick="this.textContent='Clicked'">Click me</button>
"""


async def apply(ctx, config):
    panels = ctx.use("webview-panels")
    await panels.register({"id": "hello-py", "title": "Hello (Python)", "dock": "right", "html": HTML})

    async def cleanup():
        try:
            await panels.unregister("hello-py")
        except Exception:
            pass  # attention stopping: the panel went with it

    return cleanup
