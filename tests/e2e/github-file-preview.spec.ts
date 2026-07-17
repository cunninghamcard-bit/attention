import { expect, test, type Page } from "@playwright/test";

/** A remote file preview must render as code, not as a wall of grey text.
 *
 * This lives in e2e rather than beside the other GitHub tests because the thing
 * under test does not exist in jsdom: pierre's CodeView renders into a custom
 * element's shadow root, highlights through shiki, and sizes itself by
 * measurement. jsdom has no layout and no Worker, so a unit test there would
 * assert against a component that never ran. Chromium runs the real one. */

const SECRET_KEY = "obsidian-reconstructed-secret-storage";

const SOURCE = [
  "import { readFile } from 'node:fs/promises';",
  "",
  "export async function greet(name: string): Promise<string> {",
  "  const template = await readFile('greeting.txt', 'utf8');",
  "  return template.replace('{name}', name);",
  "}",
].join("\n");

/** Long enough that the preview cannot simply be as tall as its content. */
const LONG_SOURCE = Array.from({ length: 400 }, (_, i) => `export const value${i} = ${i};`).join(
  "\n",
);

function stubGitHub(page: Page, source: string) {
  return Promise.all([
    page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
      SECRET_KEY,
      JSON.stringify({ "github-token": "e2e-token" }),
    ] as const),
    page.route("**/api.github.com/user", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ login: "e2e-user", avatar_url: "", name: "E2E User" }),
      }),
    ),
    page.route("**/api.github.com/repos/acme/demo/contents/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          name: "greet.ts",
          path: "src/greet.ts",
          type: "file",
          size: source.length,
          sha: "abc123",
          url: "",
          html_url: "https://github.com/acme/demo/blob/main/src/greet.ts",
          download_url: null,
          encoding: "base64",
          content: Buffer.from(source, "utf8").toString("base64"),
        }),
      }),
    ),
  ]);
}

async function openFile(page: Page) {
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();
  // The GitHub plugin registers its views during boot. Opening before that
  // lands leaves setViewState with no creator for the type, and it quietly
  // opens nothing — a race that reads exactly like a broken view.
  await page.waitForFunction(() =>
    Boolean(
      (
        window as unknown as {
          app?: { viewRegistry?: { getViewCreatorByType?(t: string): unknown } };
        }
      ).app?.viewRegistry?.getViewCreatorByType?.("github-detail"),
    ),
  );
  // getLeaf(true) would open a *background* tab: display:none, every box 0, and
  // getComputedStyle still reports token colours — so a highlighting assertion
  // passes against a view nobody can see. Take the active leaf instead.
  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    await app.workspace.getLeaf(false).setViewState({
      type: "github-detail",
      state: { kind: "file", path: "src/greet.ts", ref: "main", owner: "acme", repo: "demo" },
      active: true,
    });
  });
  const leaf = page.locator('.workspace-leaf-content[data-type="github-detail"]');
  // Guards the trap above: a hidden leaf would still satisfy every assertion
  // about colour, so pin visibility before measuring anything.
  await expect(leaf).toBeVisible();
  await expect(leaf.locator("diffs-container")).toBeAttached();
  return leaf;
}

/** CodeView renders into a shadow root, so the page's own selectors cannot see
 * the code. Reach through it deliberately rather than asserting on the wrapper
 * and calling that "rendered". */
const readCode = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector("diffs-container") as HTMLElement | null;
    const root = host?.shadowRoot;
    if (!root) return null;
    const colours = new Set<string>();
    for (const span of root.querySelectorAll<HTMLElement>("span")) {
      if (span.textContent?.trim()) colours.add(getComputedStyle(span).color);
    }
    return { text: root.textContent ?? "", colours: [...colours] };
  });

test("a remote file is highlighted like code, not dumped into a <pre>", async ({ page }) => {
  await stubGitHub(page, SOURCE);
  const leaf = await openFile(page);
  await expect(leaf.locator(".gh-preview-header code")).toHaveText("src/greet.ts");

  await expect.poll(async () => (await readCode(page))?.text).toContain("readFile");
  const code = await readCode(page);

  // The <pre> this replaces had one colour for the whole file. Highlighting
  // means the tokens do not share a colour — assert the difference itself, not
  // that some component is present.
  expect(code!.colours.length).toBeGreaterThan(1);
  // The old node is gone, not merely covered by the new one.
  await expect(leaf.locator(".gh-code-pre")).toHaveCount(0);
});

test("a link-styled button wears no form-control chrome", async ({ page }) => {
  await stubGitHub(page, SOURCE);
  const leaf = await openFile(page);

  // "Open on GitHub" is a linkButton (button.gh-linkish). The host's global
  // `button:not(.clickable-icon)` (button-card.css) paints a background+shadow
  // at 0-1-1; a bare `.gh-linkish` is 0-1-0 and loses, so the button wore
  // browser chrome. This asserts on a github-detail view — NOT the commit page
  // the owner flagged — so a pass here proves one CSS selector fix heals the
  // whole gh-linkish family, not just the page under the microscope. jsdom
  // cannot compute this; only a real cascade can.
  const open = leaf.locator("button.gh-linkish", { hasText: "Open on GitHub" });
  await expect(open).toBeVisible();
  const chrome = await open.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { boxShadow: cs.boxShadow, background: cs.backgroundColor };
  });
  expect(chrome.boxShadow).toBe("none");
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(chrome.background);
});

test("a long file stays inside the leaf instead of running off the bottom", async ({ page }) => {
  await stubGitHub(page, LONG_SOURCE);
  const leaf = await openFile(page);
  await expect.poll(async () => (await readCode(page))?.text).toContain("value0");

  // 400 lines cannot fit in a pane. Either the preview scrolls within the leaf
  // or the tail is unreachable, and only a real layout engine can tell which.
  const box = await leaf.evaluate((root) => {
    const scroller = root.querySelector<HTMLElement>(".view-content, .gh-code-view");
    const view = root.querySelector<HTMLElement>(".gh-code-view");
    return {
      scrollable: scroller ? scroller.scrollHeight > scroller.clientHeight : false,
      viewTop: view!.getBoundingClientRect().top,
      leafBottom: root.getBoundingClientRect().bottom,
    };
  });
  expect(box.scrollable).toBe(true);
  expect(box.viewTop).toBeLessThan(box.leafBottom);
});
