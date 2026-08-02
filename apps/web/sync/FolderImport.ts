/**
 * Input: ../vault/DataAdapter, ./LoroDataAdapter
 * Output: importFolder, TEXT_EXTENSIONS
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { ListedFiles } from "../vault/DataAdapter";
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

/** The slice of an adapter the import walks — shaped like the VaultAdapter
 * port (loose list shape, optional stat/readBinary), so the CURRENT vault's
 * adapter qualifies whatever it is; the DataAdapter class does trivially. */
export interface ImportSource {
  list(path: string): Promise<ListedFiles | string[]>;
  stat?(path: string): Promise<{ ctime?: number; mtime?: number } | null>;
  read(path: string): Promise<string>;
  readBinary?(path: string): Promise<ArrayBuffer>;
}

/** Returns the number of files imported. */
export async function importFolder(
  source: ImportSource,
  target: LoroDataAdapter,
  path = "",
): Promise<number> {
  let imported = 0;
  const listed = await source.list(path);
  // A bare string[] listing has no folder information — everything in it is
  // a file, which is exactly what such adapters mean by it.
  const files = Array.isArray(listed) ? listed : listed.files;
  const folders = Array.isArray(listed) ? [] : listed.folders;
  for (const file of files) {
    const stat = (await source.stat?.(file)) ?? null;
    const options =
      stat && (stat.ctime !== undefined || stat.mtime !== undefined)
        ? { ctime: stat.ctime, mtime: stat.mtime }
        : undefined;
    if (isTextPath(file) || !source.readBinary) {
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
