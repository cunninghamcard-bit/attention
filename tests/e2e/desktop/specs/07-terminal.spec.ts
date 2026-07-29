import { expect, test } from "../fixtures/electronApp";

async function openTerminal(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForSelector(".nav-file-title");
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const app = (window as unknown as { app: any }).app;
    const origCreate = app.terminals.createSession.bind(app.terminals);
    app.terminals.createSession = (options: unknown) => {
      const terminal = origCreate(options);
      w.__termId = terminal.id;
      return terminal;
    };
  });
  await page.evaluate(() =>
    (window as unknown as { app: any }).app.commands.executeCommandById("terminal:open"),
  );
  await page.waitForSelector(".terminal-view-surface canvas", { timeout: 30_000 });
  await page.waitForTimeout(4_000);
}

// Copy-on-select is the behavior every native terminal has, and the one most
// easily broken from the renderer side: restty preventDefaults the pointer
// stream, so a listener on `mouseup` never runs at all.
test("terminal copies the selection on release, and leaves the clipboard alone otherwise", async ({
  launchApp,
}) => {
  const { page, electronApp } = await launchApp();
  await openTerminal(page);

  await page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const app = (window as unknown as { app: any }).app;
    app.terminals.write(w.__termId as string, "echo COPYSELECTIONMARKER\r");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  });

  const box = (await page.locator(".terminal-view-surface canvas").boundingBox())!;

  // A click that selects nothing must not clobber what the user already has.
  await electronApp.evaluate(({ clipboard }) => clipboard.writeText("UNTOUCHED"));
  await page.mouse.click(box.x + 12, box.y + 200);
  await page.waitForTimeout(600);
  expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe("UNTOUCHED");
  await expect(page.locator(".notice-container .notice")).toHaveCount(0);

  // Dragging across the echoed output copies it with no explicit copy action.
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 8, box.y + 60, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain(
    "COPYSELECTIONMARKER",
  );
  await expect(page.locator(".notice-container .notice")).toHaveText("Copied to your clipboard");
});

// OSC 9 is how a long job reports from a tab nobody is looking at. Restty
// parses it and hands it back through the runtime callbacks; without that
// wiring it is silently dropped.
test("terminal surfaces an OSC 9 notification as a notice", async ({ launchApp }) => {
  const { page } = await launchApp();
  await openTerminal(page);

  await page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const app = (window as unknown as { app: any }).app;
    app.terminals.write(w.__termId as string, "printf '\\033]9;backup finished\\007'\r");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  });

  await expect(page.locator(".notice-container .notice")).toContainText("backup finished");
});
