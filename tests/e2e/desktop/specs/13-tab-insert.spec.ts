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

  // Sample INLINE states per frame IN PAGE while the new header animates. The
  // pin is the discriminating fact: without it the animated width is ignored
  // by flex layout entirely, so a run that never pins is a run where half the
  // animation silently does nothing. Sampling stays in-page because evaluate
  // round-trips can miss the whole 200ms window; and the new header is found
  // by diffing, not by position — a workspace that boots with the Welcome tab
  // active inserts the new header mid-bar, not at the end.
  const pinned = await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    const headersNow = () => [
      ...document.querySelectorAll<HTMLElement>(".mod-root .workspace-tab-header"),
    ];
    const preexisting = new Set(headersNow());
    const samples: { flex: string; width: string; opacity: string }[] = [];
    let sampling = true;
    const sample = () => {
      const el = headersNow().find((header) => !preexisting.has(header));
      if (el)
        samples.push({ flex: el.style.flex, width: el.style.width, opacity: el.style.opacity });
      if (sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const file = app.vault.getFiles().find((f: any) => f.name === "Doc.md");
    await app.workspace.getLeaf("tab").openFile(file);
    await new Promise((resolve) => setTimeout(resolve, 500));
    sampling = false;
    return samples;
  });
  const settled = await widths();

  expect(settled.length).toBe(before.length + 1);
  expect(settled.every((width) => width > 0)).toBe(true);
  expect(pinned.filter((s) => s.flex === "0 0 auto").length).toBeGreaterThan(0);
  expect(pinned.filter((s) => s.width !== "").length).toBeGreaterThan(0);

  // And it is handed back to the stylesheet: no inline flex/width left pinned.
  expect(pinned.at(-1)).toEqual({ flex: "", width: "", opacity: "" });
});
