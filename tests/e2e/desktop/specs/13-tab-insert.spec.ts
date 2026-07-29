import { expect, test } from "../fixtures/electronApp";

// A new tab header grows in over 200ms. The catch is that the faithful rule
// `.workspace .mod-root .workspace-tab-header { flex: 1 1 0 }` makes a flex
// item's main size come from its basis, so an animated `width` is ignored
// outright until the header is pinned out of flex sizing — which is why
// Obsidian sets flex:0 0 auto for the duration and clears it after.
test("a new tab header grows in rather than appearing at full width", async ({ launchApp }) => {
  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");

  const widths = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".mod-root .workspace-tab-header")].map((el) =>
        Math.round(el.getBoundingClientRect().width),
      ),
    );

  // The vault opens with one empty tab, and opening a file reuses it — fill it
  // first so the measured insertion really is a NEW header.
  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    const file = app.vault.getFiles().find((f: any) => f.name === "Note.md");
    await app.workspace.getLeaf("tab").openFile(file);
  });
  await page.waitForTimeout(800);
  const before = await widths();

  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    const file = app.vault.getFiles().find((f: any) => f.name === "Doc.md");
    await app.workspace.getLeaf("tab").openFile(file);
  });

  // Sample the new header's INLINE state while it is animating. The pin is the
  // discriminating fact: without it the animated width is ignored by flex
  // layout entirely, so a run that never pins is a run where half the
  // animation silently does nothing.
  const pinned: { flex: string; width: string; opacity: string }[] = [];
  for (let index = 0; index < 10; index++) {
    pinned.push(
      await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>(".mod-root .workspace-tab-header")].at(
          -1,
        );
        return {
          flex: el?.style.flex ?? "?",
          width: el?.style.width ?? "?",
          opacity: el?.style.opacity ?? "?",
        };
      }),
    );
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(500);
  const settled = await widths();

  expect(settled.length).toBe(before.length + 1);
  expect(settled.at(-1)!).toBeGreaterThan(0);
  expect(pinned.filter((s) => s.flex === "0 0 auto").length).toBeGreaterThan(0);
  expect(pinned.filter((s) => s.width !== "" && s.width !== "?").length).toBeGreaterThan(0);

  // And it is handed back to the stylesheet: no inline flex/width left pinned.
  expect(
    await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>(".mod-root .workspace-tab-header")].at(
        -1,
      )!;
      return { flex: el.style.flex, width: el.style.width, opacity: el.style.opacity };
    }),
  ).toEqual({ flex: "", width: "", opacity: "" });
});
