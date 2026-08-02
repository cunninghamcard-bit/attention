import { expect, test } from "../fixtures/electronApp";

// Folding the properties panel used to re-render it, which destroyed the very
// content box the collapse animates. Obsidian folds in place: three classes
// toggle synchronously and the content box eases its measured height to zero.
test("the properties panel folds in place instead of re-rendering", async ({ launchApp }) => {
  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");

  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    const file = await app.vault.create(
      "Home/Props.md",
      "---\nstatus: open\ntags: a\n---\n\nbody text\n",
    );
    await app.workspace.getLeaf(false).openFile(file);
  });
  await page.waitForSelector(".metadata-properties-heading", { timeout: 30_000 });
  await page.waitForTimeout(800);

  const contentHeight = () =>
    page.evaluate(() => {
      const el = document.querySelector(".metadata-content") as HTMLElement | null;
      return el ? Math.round(el.getBoundingClientRect().height) : -1;
    });

  const openHeight = await contentHeight();
  expect(openHeight).toBeGreaterThan(0);

  // Mark the box so a re-render is detectable: a rebuilt panel loses this.
  await page.evaluate(() => {
    (document.querySelector(".metadata-content") as HTMLElement).dataset.identityProbe = "kept";
    (document.querySelector(".metadata-properties-heading") as HTMLElement).click();
  });

  const heights: number[] = [];
  for (let index = 0; index < 10; index++) {
    heights.push(await contentHeight());
    await page.waitForTimeout(20);
  }
  expect(heights.filter((h) => h > 0 && h < openHeight).length).toBeGreaterThan(0);

  await page.waitForTimeout(400);
  expect(
    await page.evaluate(() => {
      const el = document.querySelector(".metadata-content") as HTMLElement;
      return { display: el.style.display, probe: el.dataset.identityProbe };
    }),
  ).toEqual({ display: "none", probe: "kept" });

  // All three elements carry the collapsed class, as Obsidian's do.
  expect(
    await page.evaluate(() => ({
      container: document.querySelector(".metadata-container")?.classList.contains("is-collapsed"),
      heading: document
        .querySelector(".metadata-properties-heading")
        ?.classList.contains("is-collapsed"),
      fold: document.querySelector(".collapse-indicator")?.classList.contains("is-collapsed"),
    })),
  ).toEqual({ container: true, heading: true, fold: true });
});
