import { expect, test } from "../fixtures/electronApp";

// Notices slide in from the right and fade out while collapsing their own
// height, so the stack closes in step with the fade instead of jumping when
// the element finally detaches. None of this is in app.css — the collapse
// distance is the notice's own measured height, so it lives in the animator.
test("a notice slides in and collapses the stack as it leaves", async ({ launchApp }) => {
  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");

  const state = () =>
    page.evaluate(() => {
      const el = document.querySelector(".notice") as HTMLElement | null;
      if (!el) return null;
      return {
        transform: getComputedStyle(el).transform,
        opacity: el.style.opacity,
        marginTop: el.style.marginTop,
      };
    });

  // Raised through a real command rather than constructing one: Notice is not
  // on window, and the command path is what users actually hit.
  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    const file = app.vault.getFiles().find((f: any) => f.name === "Note.md");
    await app.workspace.getLeaf(false).openFile(file);
    app.commands.executeCommandById("workspace:copy-path");
  });

  // Enters displaced to the right rather than simply appearing in place.
  const entering: string[] = [];
  for (let index = 0; index < 6; index++) {
    const s = await state();
    if (s) entering.push(s.transform);
    await page.waitForTimeout(20);
  }
  expect(entering.some((t) => t !== "none" && t !== "matrix(1, 0, 0, 1, 0, 0)")).toBe(true);

  await page.waitForTimeout(400);
  expect((await state())?.transform).toBe("none");

  // Leaving pulls the stack up: the top margin goes negative while it fades.
  await page.evaluate(() =>
    (document.querySelector(".notice") as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    ),
  );
  const leaving: { opacity: string; marginTop: string }[] = [];
  for (let index = 0; index < 6; index++) {
    const s = await state();
    if (s) leaving.push({ opacity: s.opacity, marginTop: s.marginTop });
    await page.waitForTimeout(20);
  }
  expect(leaving.some((s) => s.marginTop.startsWith("-"))).toBe(true);

  await page.waitForTimeout(400);
  expect(await state()).toBeNull();
});
