import { expect, test } from "../fixtures/electronApp";

// Three faithful rules drive `animation: spin ...`, but the @keyframes it
// names lived only in app.css's Sync section and never made it into the
// extract. An animation-name that resolves to nothing is a silent no-op: the
// loading ring renders and simply does not turn. getAnimations() is the check
// that cannot be fooled by the declaration merely being present.
test("the spin keyframes actually drive a running animation", async ({ launchApp }) => {
  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");

  const running = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.animation = "spin 1s linear infinite";
    document.body.appendChild(probe);
    const animations = probe.getAnimations().map((animation) => ({
      name: (animation as CSSAnimation).animationName,
      playState: animation.playState,
    }));
    probe.remove();
    return animations;
  });

  expect(running).toHaveLength(1);
  expect(running[0].name).toBe("spin");
  expect(running[0].playState).toBe("running");
});
