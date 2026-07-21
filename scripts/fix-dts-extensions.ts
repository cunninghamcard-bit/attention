import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = await firstExistingDirectory([
  join(process.cwd(), "out", "api", "src"),
  join(process.cwd(), "out", "src"),
  join(process.cwd(), "out", "types"),
  // unplugin-dts with the TS6 fallback applies entryRoot and emits flat.
  join(process.cwd(), "out", "api"),
]);
const relativeSpecifier =
  /((?:from\s+|export\s+\*\s+from\s+|import\s*\(\s*)["'])(\.{1,2}(?:\/[^"']+?)?)(["'])/g;

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
let redepthed = 0;
for (const file of await walk(root)) {
  const source = await readFile(file, "utf8");
  let next = source.replace(
    relativeSpecifier,
    (match, prefix: string, specifier: string, suffix: string) => {
      if (hasKnownExtension(specifier)) return match;
      changed += 1;
      // A bare "." or ".." is a directory import; point it at the index file.
      if (specifier === "." || specifier === "..") return `${prefix}${specifier}/index.js${suffix}`;
      return `${prefix}${specifier}.js${suffix}`;
    },
  );
  // The dts emitter rewrites @app/shared imports to relative paths against
  // the wrong base once the package mechanism (not an alias) resolves them.
  // Recompute the true depth from each declaration file to the emitted
  // packages/shared copies.
  next = next.replace(
    /((?:from\s+|export\s+\*\s+from\s+|import\s*\(\s*)["'])((?:\.\.\/)+)packages\/shared\//g,
    (match, prefix: string) => {
      const correct = relative(join(file, ".."), join(root, "packages", "shared"))
        .split("\\")
        .join("/");
      redepthed += 1;
      return `${prefix}${correct}/`;
    },
  );
  if (next !== source) await writeFile(file, next);
}

console.log(
  `Fixed ${changed} declaration import specifier${changed === 1 ? "" : "s"} under ${relative(process.cwd(), root)}`,
);

// The package is ESM-only; no CommonJS declaration entry is written. The
// entry may sit flat (bundled) or nested under the package path (unbundled
// with a repo-root entryRoot) — verify it exists so a layout change fails
// loudly here instead of at pack time.
const entryDir = await firstExistingDirectory([join(root, "apps", "web"), root]);
await stat(join(entryDir, "index.d.ts"));

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
