import { expect, test } from "../fixtures/electronApp";

// The stray "app window": with no window-open handler, Chromium answers a
// `target="_blank"` click by building a bare BrowserWindow — neither the Web
// viewer nor the OS browser. These specs assert the real app never does that.
//
// Every URL here is deliberately non-http so the handler's `shell.openExternal`
// branch stays untouched: an e2e run must not pop the tester's real browser.

test("a target=_blank click never opens a native child window", async ({ app }) => {
  const { electronApp, page } = app;
  const windowsBefore = electronApp.windows().length;

  await page.evaluate(() => {
    const linkEl = document.createElement("a");
    linkEl.href = "about:blank";
    linkEl.target = "_blank";
    linkEl.textContent = "external";
    linkEl.id = "e2e-external-link";
    document.body.appendChild(linkEl);
    linkEl.click();
  });
  await page.waitForTimeout(1000);

  expect(electronApp.windows()).toHaveLength(windowsBefore);
});

test("window.open is denied rather than framed into its own window", async ({ app }) => {
  const { electronApp, page } = app;
  const windowsBefore = electronApp.windows().length;

  const opened = await page.evaluate(() => window.open("about:blank", "_blank"));
  await page.waitForTimeout(1000);

  expect(opened).toBeNull();
  expect(electronApp.windows()).toHaveLength(windowsBefore);
});

test("the renderer routes external links through the cancelable open-url event", async ({
  app,
}) => {
  const { page } = app;

  const detail = await page.evaluate(() => {
    return new Promise<{ url: string; leaf: string; active: boolean } | null>((resolve) => {
      const listener = (event: Event): void => {
        event.preventDefault();
        window.removeEventListener("open-url", listener);
        resolve((event as CustomEvent<{ url: string; leaf: string; active: boolean }>).detail);
      };
      window.addEventListener("open-url", listener);
      const linkEl = document.createElement("a");
      linkEl.href = "https://obsidian.md/";
      linkEl.target = "_blank";
      document.body.appendChild(linkEl);
      linkEl.click();
      window.setTimeout(() => resolve(null), 2000);
    });
  });

  expect(detail).toEqual({ url: "https://obsidian.md/", leaf: "tab", active: true });
});
