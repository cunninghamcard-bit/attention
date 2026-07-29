import { expect, test } from "../fixtures/electronApp";

// Our callouts painted a `callout-note` class on the inner <p> and left the
// <blockquote> standing. app.css keys all 26 type rules off
// `.callout[data-callout="..."]`, so every one of them missed — the styles
// were shipped and unreachable. This asserts the real contract, and the fold.
test("callouts render Obsidian's structure and fold on click", async ({ launchApp }) => {
  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");

  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    const file = await app.vault.create(
      "Callout.md",
      "> [!warning]- Heads up\n> body line one\n\n> [!note] Plain\n> not collapsible\n",
    );
    await app.workspace.getLeaf(false).openFile(file);
    await app.workspace.getActiveViewOfType?.(Object)?.setMode?.("preview");
  });
  await page.waitForSelector(".callout", { timeout: 30_000 });
  await page.waitForTimeout(600);

  const shape = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".callout")];
    return {
      count: els.length,
      blockquotesLeft: document.querySelectorAll(".markdown-rendered blockquote").length,
      first: {
        type: els[0]?.getAttribute("data-callout"),
        fold: els[0]?.getAttribute("data-callout-fold"),
        collapsible: els[0]?.classList.contains("is-collapsible"),
        collapsed: els[0]?.classList.contains("is-collapsed"),
        title: els[0]?.querySelector(".callout-title-inner")?.textContent,
        // Icon comes from the --callout-icon cascade, not from JS.
        hasIcon: Boolean(els[0]?.querySelector(".callout-icon svg")),
        // The chevron is the LAST child of the title, after icon and text.
        foldIsLast:
          els[0]?.querySelector(".callout-title")?.lastElementChild?.classList.contains(
            "callout-fold",
          ) ?? false,
      },
      second: {
        type: els[1]?.getAttribute("data-callout"),
        collapsible: els[1]?.classList.contains("is-collapsible"),
        hasFold: Boolean(els[1]?.querySelector(".callout-fold")),
      },
    };
  });

  expect(shape.count).toBe(2);
  expect(shape.blockquotesLeft).toBe(0);
  // `-` starts collapsed, and that initial state is NOT animated.
  expect(shape.first).toEqual({
    type: "warning",
    fold: "-",
    collapsible: true,
    collapsed: true,
    title: "Heads up",
    hasIcon: true,
    foldIsLast: true,
  });
  // A bare `[!note]` gets no chevron and no collapsible affordance at all.
  expect(shape.second).toEqual({ type: "note", collapsible: false, hasFold: false });

  // Clicking the chevron expands it, and that one IS animated.
  await page.evaluate(() =>
    (document.querySelector(".callout-fold") as HTMLElement).dispatchEvent(
      // cancelable matters: the chevron's preventDefault is what stops the
      // title's fallback handler from toggling a second time.
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    ),
  );
  const heights: number[] = [];
  for (let index = 0; index < 8; index++) {
    heights.push(
      await page.evaluate(() =>
        Math.round(
          (document.querySelector(".callout-content") as HTMLElement).getBoundingClientRect()
            .height,
        ),
      ),
    );
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(400);
  const finalHeight = await page.evaluate(() =>
    Math.round(
      (document.querySelector(".callout-content") as HTMLElement).getBoundingClientRect().height,
    ),
  );
  expect(finalHeight).toBeGreaterThan(0);
  expect(heights.filter((h) => h > 0 && h < finalHeight).length).toBeGreaterThan(0);
});
