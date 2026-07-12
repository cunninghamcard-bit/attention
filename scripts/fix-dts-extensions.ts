import { copyFile, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = await firstExistingDirectory([
  join(process.cwd(), "dist", "api", "src"),
  join(process.cwd(), "dist", "src"),
  join(process.cwd(), "dist", "types"),
  // unplugin-dts with the TS6 fallback applies entryRoot and emits flat.
  join(process.cwd(), "dist", "api"),
]);
const relativeSpecifier =
  /((?:from\s+|export\s+\*\s+from\s+|import\s*\(\s*)["'])(\.{1,2}\/[^"']+?)(["'])/g;

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && path.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

function hasKnownExtension(specifier: string): boolean {
  return /\.(?:js|mjs|cjs|json|d\.ts)$/.test(specifier);
}

let changed = 0;
for (const file of await walk(root)) {
  const source = await readFile(file, "utf8");
  const next = source.replace(
    relativeSpecifier,
    (match, prefix: string, specifier: string, suffix: string) => {
      if (hasKnownExtension(specifier)) return match;
      changed += 1;
      return `${prefix}${specifier}.js${suffix}`;
    },
  );
  if (next !== source) await writeFile(file, next);
}

console.log(
  `Fixed ${changed} declaration import specifier${changed === 1 ? "" : "s"} under ${relative(process.cwd(), root)}`,
);

await copyFile(join(root, "index.d.ts"), join(root, "index.d.cts"));
console.log(
  `Wrote CommonJS declaration entry ${relative(process.cwd(), join(root, "index.d.cts"))}`,
);

async function firstExistingDirectory(paths: string[]): Promise<string> {
  for (const path of paths) {
    try {
      if ((await stat(path)).isDirectory()) return path;
    } catch {}
  }
  throw new Error(
    `No declaration output directory found. Tried: ${paths.map((path) => relative(process.cwd(), path)).join(", ")}`,
  );
}
