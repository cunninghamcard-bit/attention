/**
 * Input: node:child_process, node:util
 * Output: listSystemFontFamilies
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * Main-process system font enumeration, exposed to the renderer as the
 * `get-fonts` IPC channel (Obsidian's seam name; its own `get-fonts` native
 * addon is UNLICENSED and cannot be copied).
 *
 * This asks the OS directly instead of going through the `font-list` package,
 * which cannot survive this build. Three ways, all dead ends:
 *
 * - bundled as ESM — its entry is `createRequire(import.meta.url)`, and a CJS
 *   build rewrites `import.meta.url` to `{}.url`, i.e. undefined. The chunk
 *   throws on load: "The argument 'filename' must be a file URL object …
 *   Received undefined".
 * - bundled as CJS — its darwin backend locates a compiled `fontlist` binary
 *   with `path.join(__dirname, "fontlist")`, and `__dirname` becomes
 *   `out/desktop` once bundled, so the binary is gone.
 * - marked external — pnpm links it under `apps/desktop/node_modules`, which is
 *   not on the resolve path from `out/desktop/main.cjs` (MODULE_NOT_FOUND).
 *
 * Every one of those failures landed in a `catch { return [] }`, so the renderer
 * saw "this machine has no fonts" and the font picker silently fell back to a
 * hardcoded seed list — every third-party font (Nerd Fonts, Maple Mono) missing
 * from search with no error anywhere.
 *
 * `system_profiler` takes a second or two; the renderer caches the catalog, and
 * it is the same call `font-list` falls back to when its binary is unavailable.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 32 * 1024 * 1024;

/** `Family: <name>` lines out of `system_profiler SPFontsDataType`. */
function parseSystemProfilerFamilies(stdout: string): string[] {
  const families = new Set<string>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*Family:\s*(.+?)\s*$/.exec(line);
    if (match?.[1]) families.add(match[1]);
  }
  return [...families];
}

/** One family per line from fontconfig. */
function parseFcListFamilies(stdout: string): string[] {
  const families = new Set<string>();
  for (const line of stdout.split("\n")) {
    // fc-list can return comma-separated aliases; the first is the family.
    const name = line.split(",")[0]?.trim();
    if (name) families.add(name);
  }
  return [...families];
}

export async function listSystemFontFamilies(): Promise<string[]> {
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("system_profiler", ["SPFontsDataType"], {
      maxBuffer: MAX_BUFFER,
    });
    return parseSystemProfilerFamilies(stdout).sort((a, b) => a.localeCompare(b));
  }
  if (process.platform === "linux") {
    const { stdout } = await execFileAsync("fc-list", ["--format=%{family}\\n"], {
      maxBuffer: MAX_BUFFER,
    });
    return parseFcListFamilies(stdout).sort((a, b) => a.localeCompare(b));
  }
  // No silent []: an empty list is indistinguishable from "no fonts installed",
  // which is what hid the bundling failure above for so long.
  throw new Error(`Font enumeration is not implemented for ${process.platform}.`);
}
