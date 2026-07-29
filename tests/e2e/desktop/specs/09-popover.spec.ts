import { expect, test } from "../fixtures/electronApp";

// The hover popover fades in over 80ms. What is easy to lose is that the
// easing is the TOKEN, not its value: a theme may redefine
// --anim-motion-swing, and Obsidian's popover follows it. The Web Animations
// API cannot take a CSS variable for `easing`, so following the token is only
// possible through an inline transition — this asserts the token still wins.
test("hover popover eases through the motion token, not a baked-in curve", async ({
  launchApp,
}) => {
  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");

  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    const file = app.vault.getFiles().find((f: any) => f.name === "Note.md");
    await app.workspace.getLeaf(false).openFile(file);
  });
  await page.waitForTimeout(1_500);

  // A distinctive override no hardcoded bezier could ever produce.
  await page.evaluate(() =>
    document.body.style.setProperty("--anim-motion-swing", "steps(4, end)"),
  );

  await page.locator(".internal-link").first().hover();

  const easings = await page.evaluate(async () => {
    const seen: string[] = [];
    for (let index = 0; index < 25; index++) {
      const el = document.querySelector(".hover-popover");
      if (el) seen.push(getComputedStyle(el).transitionTimingFunction);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return seen;
  });

  expect(easings.length).toBeGreaterThan(0);
  expect(easings).toContain("steps(4)");
  // And the animator hands the element back: the inline transition is gone
  // once it settles, so the popover is not left pinned to an inline style.
  expect(easings.at(-1)).toBe("ease");
});
