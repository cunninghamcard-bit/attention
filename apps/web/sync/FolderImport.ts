/**
 * Input: ../vault/DataAdapter, ./LoroDataAdapter
 * Output: importFolder, TEXT_EXTENSIONS
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { DataAdapter } from "../vault/DataAdapter";
import type { LoroDataAdapter } from "./LoroDataAdapter";

/**
 * One-time ingestion of an existing vault into a synced one: walk any
 * source adapter (a local folder through FileSystemAdapter, typically) and
 * copy everything across. Text-shaped files become collaborative text
 * docs; everything else becomes a content-addressed blob. This is the
 * filesystem's whole role for synced vaults — import (and later export),
 * no live bridge.
 */

export const TEXT_EXTENSIONS = new Set([
  "md",
  "txt",
  "json",
  "css",
  "js",
  "mjs",
  "ts",
  "canvas",
  "base",
  "html",
  "xml",
  "yml",
  "yaml",
  "svg",
]);

function isTextPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/** Returns the number of files imported. */
export async function importFolder(
  source: DataAdapter,
  target: LoroDataAdapter,
  path = "",
): Promise<number> {
  let imported = 0;
  const { files, folders } = await source.list(path);
  for (const file of files) {
    const stat = await source.stat(file);
    const options = stat ? { ctime: stat.ctime, mtime: stat.mtime } : undefined;
    if (isTextPath(file)) {
      await target.write(file, await source.read(file), options);
    } else {
      await target.writeBinary(file, await source.readBinary(file), options);
    }
    imported += 1;
  }
  for (const folder of folders) {
    await target.mkdir(folder);
    imported += await importFolder(source, target, folder);
  }
  return imported;
}
