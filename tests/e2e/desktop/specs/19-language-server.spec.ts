import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/electronApp";

// The whole path in the real app: preload bridge → a real language server
// process → the client in the code view. Needs `ty` on PATH; skips without it.
const hasTy = (() => {
  try {
    execFileSync("ty", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const SHAPES = [
  "class Shape:",
  '    """A thing with an area."""',
  "",
  "    def area(self) -> float:",
  "        raise NotImplementedError",
  "",
  "",
  "class Square(Shape):",
  "    def __init__(self, side: float) -> None:",
  "        self.side = side",
  "",
  "    def area(self) -> float:",
  "        return self.side * self.side",
  "",
].join("\n");

const MAIN = [
  "from pkg.shapes import Square",
  "",
  "",
  "def total(squares: list[Square]) -> float:",
  "    return sum(square.area() for square in squares)",
  "",
].join("\n");

function seedProject(vault: string): void {
  mkdirSync(join(vault, "pkg"), { recursive: true });
  writeFileSync(join(vault, "pkg", "__init__.py"), "");
  writeFileSync(join(vault, "pkg", "shapes.py"), SHAPES);
  writeFileSync(join(vault, "main.py"), MAIN);
}

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function openFile(page: Page, path: string): Promise<void> {
  await page.evaluate(async (target) => {
    const app = (window as unknown as { app: any }).app;
    await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(target), {
      active: true,
    });
  }, path);
}

/** Screen coordinates of the middle of `needle` in the active code editor. */
async function coordsOf(page: Page, needle: string, skip = 0): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ text, offset }) => {
      const app = (window as unknown as { app: any }).app;
      const view = app.workspace.activeLeaf.view.editorView;
      const at = view.state.doc.toString().indexOf(text) + offset;
      const box = view.coordsAtPos(at);
      return { x: box.left + 2, y: (box.top + box.bottom) / 2 };
    },
    { text: needle, offset: skip },
  );
}

const activeState = (page: Page) =>
  page.evaluate(() => {
    const app = (window as unknown as { app: any }).app;
    const view = app.workspace.activeLeaf.view;
    const selection = view.editorView.state.selection.main;
    return {
      path: view.file?.path as string,
      selected: view.editorView.state.sliceDoc(selection.from, selection.to) as string,
    };
  });

test.describe("language servers", () => {
  test.skip(!hasTy, "ty is not installed");

  test("hover, jump to definition and references, on one server", async ({
    vaultPath,
    launchApp,
  }) => {
    seedProject(vaultPath);
    const { page } = await launchApp();

    await openFile(page, "vault/main.py");
    await page.waitForFunction(() => {
      const app = (window as unknown as { app: any }).app;
      const [server] = app.languageServers.status();
      return server?.state === "ready" && server.documents === 1;
    });
    expect(
      await page.evaluate(() => (window as unknown as { app: any }).app.languageServers.status()),
    ).toMatchObject([{ server: "ty", language: "python", root: "vault" }]);

    // Hover: the server's answer, drawn in the app's own tooltip surface.
    const area = await coordsOf(page, "square.area()", "square.".length);
    await page.mouse.move(area.x, area.y);
    const tooltip = page.locator(".code-file-view .cm-tooltip-hover");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("area");
    const background = await tooltip.evaluate((el) => getComputedStyle(el).backgroundColor);
    const expected = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.background = "var(--background-primary)";
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    // Themed by the app, not the library's white default.
    expect(background).toBe(expected);

    // Mod+click: the definition opens in the same tab, with the name selected.
    await page.keyboard.down(mod);
    await page.mouse.click(area.x, area.y);
    await page.keyboard.up(mod);
    await expect.poll(() => activeState(page)).toEqual({ path: "vault/pkg/shapes.py", selected: "area" });

    // Shift+F12 on `Square`: every use, across files — including main.py's,
    // whose tab the jump above replaced — in the References pane.
    const square = await coordsOf(page, "class Square", "class ".length);
    await page.mouse.click(square.x, square.y);
    await page.keyboard.press("Shift+F12");
    const pane = page.locator(".workspace-leaf-content[data-type='language-references']");
    await expect(pane.locator(".search-result-file-match").first()).toBeVisible();
    await expect(pane.locator(".search-result-file-title")).toHaveText([
      "vault/pkg/shapes.py",
      "vault/main.py",
    ]);
    const lines = await pane.locator(".search-result-file-match-text").allTextContents();
    expect(lines).toContain("from pkg.shapes import Square");
    expect(lines).toContain("class Square(Shape):");

    // A row is a jump: the use in the other file opens with the name selected.
    await pane.locator(".search-result-file-match", { hasText: "def total" }).click();
    await expect.poll(() => activeState(page)).toEqual({ path: "vault/main.py", selected: "Square" });
  });
});
