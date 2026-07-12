import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Per-click latency harness on a synthetic huge vault (default 20k files,
// shaped like a code repo: many small files across many folders, plus a
// handful of notes to switch between). Gated behind ARKLOOP_PERF=1 so the
// regular e2e suite never pays the seeding cost:
//
//   ARKLOOP_PERF=1 pnpm exec playwright test e2e/perf/large-vault.spec.ts
//
// Metrics (all in ms, printed as one JSON line prefixed PERF_RESULT):
// - openFile: workspace.openLinkText -> double-rAF (pure app cost, no
//   pointer/playwright overhead), per switch across 8 alternating notes
// - explorerClick: physical click on a nav-file-title -> file-open event ->
//   double-rAF (includes explorer handlers on the critical path)
// - longTasks: main-thread long tasks observed during the measured clicks

const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SPEC_DIR, "..", "..");
const MAIN_CJS = join(REPO_ROOT, "dist-electron", "main.cjs");

const JUNK_FILES = Number(process.env.ARKLOOP_PERF_FILES || 20000);
const FILES_PER_DIR = 40;

test.skip(!process.env.ARKLOOP_PERF, "perf harness — run with ARKLOOP_PERF=1");

function seedLargeVault(vault: string): void {
  const dirs = Math.ceil(JUNK_FILES / FILES_PER_DIR);
  for (let d = 0; d < dirs; d++) {
    const dir = join(vault, "junk", `pkg-${String(Math.floor(d / 50)).padStart(2, "0")}`, `mod-${String(d).padStart(4, "0")}`);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < FILES_PER_DIR && d * FILES_PER_DIR + f < JUNK_FILES; f++) {
      writeFileSync(join(dir, `file-${f}.js`), "export const x = 1;\n");
    }
  }
  mkdirSync(join(vault, "notes"), { recursive: true });
  for (let n = 0; n < 8; n++) {
    writeFileSync(
      join(vault, "notes", `note-${n}.md`),
      `# Note ${n}\n\nSome text with a [[note-${(n + 1) % 8}]] link and a #tag${n}.\n\n${"lorem ipsum ".repeat(200)}\n`,
    );
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test("per-click latency on a huge vault", async ({}, testInfo) => {
  test.setTimeout(600_000);
  const base = mkdtempSync(join(tmpdir(), "arkloop-perf-"));
  const vault = join(base, "vault");
  const seedStart = Date.now();
  seedLargeVault(vault);
  console.log(`seeded ${JUNK_FILES} junk files in ${Date.now() - seedStart}ms`);

  const env = {
    ...process.env,
    ARKLOOP_VAULT_PATH: vault,
    ARKLOOP_USER_DATA: join(base, "userData"),
    ARKLOOP_CLI_SOCKET: join(base, "cli.sock"),
  };
  delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({ args: [MAIN_CJS], cwd: REPO_ROOT, env, timeout: 120_000 });
  app.process().stderr?.on("data", (chunk: Buffer) => console.log(`MAIN-STDERR ${String(chunk).slice(0, 500)}`));
  app.process().stdout?.on("data", (chunk: Buffer) => console.log(`MAIN-STDOUT ${String(chunk).slice(0, 500)}`));
  app.on("close", () => console.log("ELECTRON APP CLOSED"));
  try {
    const page = await app.firstWindow();
    page.on("close", () => console.log("PAGE CLOSED"));
    page.on("crash", () => console.log("RENDERER CRASHED"));
    page.on("pageerror", (error) => console.log(`PAGEERROR ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`CONSOLE-ERROR ${message.text().slice(0, 300)}`);
    });
    const launchStart = Date.now();
    await expect(page.locator(".nav-folder-title", { hasText: "notes" }).first()).toBeVisible({ timeout: 180_000 });
    const vaultReadyMs = Date.now() - launchStart;

    // Long-task observer for the whole measured window.
    await page.evaluate(() => {
      const w = window as unknown as { __longTasks: number[] };
      w.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__longTasks.push(Math.round(entry.duration));
      }).observe({ entryTypes: ["longtask"] });
    });

    // Pure app cost: openLinkText -> paint, alternating notes.
    const openFile: number[] = [];
    for (let i = 0; i < 8; i++) {
      const ms = await page.evaluate(async (name) => {
        const anyWin = window as unknown as { app: { workspace: { openLinkText: (link: string, from: string, newLeaf: boolean) => Promise<void> } } };
        const start = performance.now();
        await anyWin.app.workspace.openLinkText(name, "/", false);
        await new Promise<void>((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())));
        return Math.round(performance.now() - start);
      }, `notes/note-${i % 4}.md`);
      openFile.push(ms);
    }

    // Physical explorer clicks: expand notes folder first if needed, then
    // click alternating visible notes; measure click dispatch -> file-open ->
    // double-rAF in-page.
    const notesFolder = page.locator(".nav-folder-title", { hasText: "notes" }).first();
    await notesFolder.click();
    const explorerClick: number[] = [];
    for (let i = 0; i < 6; i++) {
      const target = `note-${4 + (i % 2)}`;
      const waitPaint = page.evaluate((expected) => {
        const anyWin = window as unknown as {
          app: { workspace: { on: (name: string, cb: (...args: unknown[]) => void) => unknown; offref: (ref: unknown) => void } };
        };
        return new Promise<number>((resolvePaint) => {
          const start = performance.now();
          const ref = anyWin.app.workspace.on("file-open", (file) => {
            const path = (file as { path?: string } | null)?.path ?? "";
            if (!path.includes(expected)) return;
            anyWin.app.workspace.offref(ref);
            requestAnimationFrame(() => requestAnimationFrame(() =>
              resolvePaint(Math.round(performance.now() - start))));
          });
        });
      }, target);
      await page.locator(".nav-file-title", { hasText: target }).first().click();
      explorerClick.push(await waitPaint);
    }

    const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
    const result = {
      junkFiles: JUNK_FILES,
      vaultReadyMs,
      openFile,
      openFileMedian: median(openFile),
      explorerClick,
      explorerClickMedian: median(explorerClick),
      longTasksOver100ms: longTasks.filter((t) => t >= 100),
    };
    console.log(`PERF_RESULT ${JSON.stringify(result)}`);
    await testInfo.attach("perf-result.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  } finally {
    await app.close();
    rmSync(base, { recursive: true, force: true });
  }
});
