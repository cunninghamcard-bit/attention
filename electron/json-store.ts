import * as fs from "node:fs";
import { join } from "node:path";

/**
 * Per-name JSON files under the Electron `userData` directory.
 *
 * Faithful to the reverse note's `Q/ne/G/re` helpers: real Obsidian persists
 * its settings as `userData/obsidian.json` and each vault window's state as
 * `userData/<vaultId>.json`, always via best-effort synchronous fs calls that
 * swallow errors (`ae(...)` wrapper) — a broken/missing file must never crash
 * the main process.
 */
export class JsonStore {
  constructor(private readonly dir: string) {}

  /** Real `Q(name)`: the absolute path of a store file. */
  pathFor(name: string): string {
    return join(this.dir, `${name}.json`);
  }

  /** Real `G(name)`: read+parse, `{}` on any failure. */
  read<T extends object>(name: string, fallback: T): T {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.pathFor(name), "utf8"));
      return (parsed ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  /** Real `ne(name, data)`: best-effort synchronous write. */
  write(name: string, data: unknown): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.pathFor(name), JSON.stringify(data));
    } catch {
      // Persistence is best-effort, matching real Obsidian.
    }
  }

  /** Real `re(name)`: best-effort delete. */
  remove(name: string): void {
    try {
      fs.unlinkSync(this.pathFor(name));
    } catch {
      // Already gone — fine.
    }
  }
}
