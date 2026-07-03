/**
 * Decompose the vendored Obsidian `app.css` into ordered design-framework
 * partials under `src/styles/app/`, and rewrite `app.css` as an `@import`
 * barrel that pulls them back in the exact original order.
 *
 * The split is byte-lossless BY CONSTRUCTION: every partial is a contiguous
 * line-range of the original, cut only at top-level rule boundaries, and the
 * barrel imports them in source order — so Vite inlines them back to the
 * identical rule set in the identical cascade order. The script refuses to run
 * unless the input hashes to the known-good vendored artifact, and asserts the
 * reassembled bytes hash back to it before writing anything.
 *
 * Re-run after re-vendoring a new app.css: restore the raw file first (the
 * script reads `decode-obsidian/ref/obsidian/app.css` when present, else the
 * current `src/styles/app.css`), then update GOLDEN_SHA256 and the section map.
 *
 *   bun scripts/split-app-css.ts          # write the split
 *   bun scripts/split-app-css.ts --check  # verify only, write nothing
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GOLDEN_SHA256 = "6245db88b65b1728ef136cc79b3ce3ef85ab860944abbe5198e9d6bd9abe9bea";
const TOTAL_LINES = 20643;

const OUT_DIR = "src/styles/app";
const BARREL = "src/styles/app.css";
const SOURCES = ["decode-obsidian/ref/obsidian/app.css", "src/styles/app.css"];

/**
 * The design-framework section map, recovered from the compiled file's
 * (SCSS-partial) source order. `start` is the 1-based first line; each section
 * runs until the next one begins. Order is the cascade — do not reorder.
 * `layer` groups sections into Obsidian's design-system layers for navigation.
 */
type Layer = "vendor" | "foundations" | "shell" | "components" | "settings" | "editor" | "plugins" | "platform";
interface Section { start: number; slug: string; layer: Layer; title: string }

const SECTIONS: Section[] = [
  { start: 1, slug: "pdfjs-messagebar-dialog", layer: "vendor", title: "pdf.js — messageBar, editorUndoBar, dialog (vendored, do not edit)" },
  { start: 1443, slug: "pdfjs-viewer", layer: "vendor", title: "pdf.js — xfaLayer, pdfViewer (vendored, do not edit)" },
  { start: 1998, slug: "foundations-tokens", layer: "foundations", title: "Design tokens — master body{} block, theme-light/dark, @font-face" },
  { start: 3123, slug: "base-reset", layer: "foundations", title: "Base reset — *, html, body, translucency, node-inserted" },
  { start: 3188, slug: "shell-app-container", layer: "shell", title: "App container, horizontal-main-container, attachments gallery" },
  { start: 3316, slug: "editor-cm-cursor", layer: "editor", title: "CodeMirror core — cursor, blink, tab, strikethrough" },
  { start: 3378, slug: "editor-source-view", layer: "editor", title: "Markdown source view, drag-ghost" },
  { start: 3466, slug: "editor-cm6", layer: "editor", title: "CodeMirror 6 source view, table widget, edit-block button" },
  { start: 3849, slug: "shell-empty-state", layer: "shell", title: "Empty state, feedback banner" },
  { start: 3930, slug: "shell-titlebar-frameless", layer: "shell", title: "Titlebar / frameless OS chrome, loader spinner" },
  { start: 4188, slug: "shell-view-header", layer: "shell", title: "View header, view content" },
  { start: 4303, slug: "editor-inline-title", layer: "editor", title: "Inline title, ::selection" },
  { start: 4340, slug: "editor-reading-view", layer: "editor", title: "Markdown reading / preview view wrappers" },
  { start: 4391, slug: "shell-ribbon-sidedock", layer: "shell", title: "Workspace ribbon, side dock, release notes" },
  { start: 4501, slug: "base-rtl", layer: "foundations", title: "RTL / bidi mirroring" },
  { start: 4683, slug: "settings-setting-item", layer: "settings", title: "Setting item, settings modal, hotkeys" },
  { start: 5271, slug: "plugins-community-plugins", layer: "plugins", title: "Community plugins browser" },
  { start: 5536, slug: "shell-status-bar", layer: "shell", title: "Status bar" },
  { start: 5607, slug: "shell-titlebar-inner-vault-profile", layer: "shell", title: "Titlebar inner / buttons, translucency, vault profile" },
  { start: 5834, slug: "shell-workspace-split-tabs", layer: "shell", title: "Workspace split, leaf, resize handles, tabs" },
  { start: 6637, slug: "components-button-card", layer: "components", title: "Button, card, changelog, list-item, diff view" },
  { start: 6951, slug: "components-document-search", layer: "components", title: "Document search & replace, search highlight" },
  { start: 7049, slug: "components-dropdown", layer: "components", title: "Dropdown, select, combobox, flair" },
  { start: 7210, slug: "components-collapse-indicator", layer: "components", title: "Collapse indicator, fold, collapse icon" },
  { start: 7336, slug: "components-clickable-icon", layer: "components", title: "Clickable icon, svg-icon, text-icon-button, indentation guides" },
  { start: 7589, slug: "components-text-input", layer: "components", title: "Text input, textarea, date, slider, color, formula editor" },
  { start: 7923, slug: "components-notice", layer: "components", title: "Notice" },
  { start: 7979, slug: "components-menu", layer: "components", title: "Menu" },
  { start: 8085, slug: "components-modal-dialog", layer: "components", title: "Modal, dialog, message, nav-header, multi-select" },
  { start: 8461, slug: "components-popover-prompt-scrollbar", layer: "components", title: "Popover, progress bar, prompt, scrollbar" },
  { start: 8855, slug: "components-suggestion-tabs", layer: "components", title: "Suggestion / autocomplete, horizontal & vertical tabs" },
  { start: 9199, slug: "components-checkbox", layer: "components", title: "Checkbox" },
  { start: 9324, slug: "components-tooltip", layer: "components", title: "Tooltip" },
  { start: 9446, slug: "components-tree-item", layer: "components", title: "Tree item, drop indicator, audio / kbd" },
  { start: 9640, slug: "plugins-pdf-view", layer: "plugins", title: "PDF view — container, sidebar, toolbar, findbar, popup" },
  { start: 10331, slug: "editor-callout", layer: "editor", title: "Callouts" },
  { start: 10476, slug: "editor-code", layer: "editor", title: "Code — inline, block, HyperMD codeblock" },
  { start: 10649, slug: "editor-syntax-highlight", layer: "editor", title: "Syntax highlighting — Prism tokens, CodeMirror token colors" },
  { start: 10808, slug: "editor-embeds", layer: "editor", title: "Embeds — pdf, file, markdown, image, iframe" },
  { start: 11091, slug: "editor-footnotes", layer: "editor", title: "Footnotes" },
  { start: 11161, slug: "editor-properties-metadata", layer: "editor", title: "Metadata, properties, frontmatter" },
  { start: 11665, slug: "editor-headings-hr", layer: "editor", title: "Headings, horizontal rule, internal query" },
  { start: 12009, slug: "editor-lists", layer: "editor", title: "Lists — ul/ol, bullets, indent" },
  { start: 12628, slug: "editor-tables", layer: "editor", title: "Tables" },
  { start: 12838, slug: "editor-links-tasks", layer: "editor", title: "Links, tags, task lists" },
  { start: 13062, slug: "editor-rendered-content", layer: "editor", title: "Rendered paragraphs / mark, backlinks in preview" },
  { start: 13256, slug: "plugins-bases", layer: "plugins", title: "Bases — embed, toolbar, filters, views" },
  { start: 14683, slug: "plugins-bookmarks-nav", layer: "plugins", title: "Bookmarks, nav folder, file tree flair" },
  { start: 14826, slug: "plugins-file-recovery", layer: "plugins", title: "File recovery" },
  { start: 14895, slug: "plugins-graph-outline", layer: "plugins", title: "Graph view, graph controls, outline, properties" },
  { start: 15195, slug: "plugins-publish", layer: "plugins", title: "Publish — sections, upload, site list, custom nav" },
  { start: 15407, slug: "plugins-search", layer: "plugins", title: "Search view — input, results, params, slides" },
  { start: 15904, slug: "plugins-sync", layer: "plugins", title: "Sync — vault list, history, log, recent changes" },
  { start: 16418, slug: "plugins-tag-pane-canvas", layer: "plugins", title: "Tag pane, canvas — node, edge, menu, minimap" },
  { start: 17294, slug: "plugins-webviewer-workspaces", layer: "plugins", title: "Webviewer, manage workspaces, footnotes view" },
  { start: 17482, slug: "shell-starter-splash", layer: "shell", title: "Starter, splash, open-vault welcome screen" },
  { start: 17749, slug: "platform-mobile", layer: "platform", title: "Mobile — is-mobile / is-phone / is-tablet / is-ios, vault chooser" },
];

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 1-based char index where each line starts; index [n+1] == text.length. */
function lineStarts(text: string): number[] {
  const starts = [0, 0]; // starts[1] = 0 (line 1 begins at char 0)
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** Start line (1-based) of every top-level node, string/comment aware. */
function topLevelNodeStartLines(text: string): Set<number> {
  const starts = new Set<number>();
  const n = text.length;
  let line = 1;
  let depth = 0;
  let atNodeStart = true; // between nodes at depth 0, awaiting first meaningful char
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c === "\n") { line++; continue; }
    if (c === " " || c === "\t" || c === "\r" || c === "\f") continue;
    // comments
    if (c === "/" && text[i + 1] === "*") {
      if (depth === 0 && atNodeStart) { starts.add(line); atNodeStart = false; }
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { if (text[i] === "\n") line++; i++; }
      i += 1; // land on '/', loop ++ consumes it
      if (depth === 0) atNodeStart = true; // a standalone comment is its own node
      continue;
    }
    // strings
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n && text[i] !== quote) { if (text[i] === "\\") i++; else if (text[i] === "\n") line++; i++; }
      continue;
    }
    if (depth === 0 && atNodeStart) { starts.add(line); atNodeStart = false; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) atNodeStart = true; }
    else if (c === ";" && depth === 0) atNodeStart = true; // top-level statement (@import/@charset)
  }
  return starts;
}

function validate(css: string): void {
  const inputSha = sha256(css);
  if (inputSha !== GOLDEN_SHA256) {
    throw new Error(
      `Input app.css does not match the known-good vendored artifact.\n` +
      `  expected ${GOLDEN_SHA256}\n  got      ${inputSha}\n` +
      `Refusing to split a modified file — restore the raw vendored app.css first.`,
    );
  }
  const nodeStarts = topLevelNodeStartLines(css);
  const totalLines = css.endsWith("\n") ? css.split("\n").length - 1 : css.split("\n").length;
  if (totalLines !== TOTAL_LINES) throw new Error(`Expected ${TOTAL_LINES} lines, got ${totalLines}`);

  if (SECTIONS[0].start !== 1) throw new Error("First section must start at line 1");
  for (let k = 0; k < SECTIONS.length; k++) {
    const s = SECTIONS[k];
    if (k > 0 && s.start <= SECTIONS[k - 1].start) throw new Error(`Sections must strictly ascend: ${s.slug}`);
    if (!nodeStarts.has(s.start)) {
      throw new Error(`Section "${s.slug}" start line ${s.start} is not a top-level rule boundary (would split a rule).`);
    }
    const slugs = SECTIONS.filter((x) => x.slug === s.slug);
    if (slugs.length > 1) throw new Error(`Duplicate slug: ${s.slug}`);
  }
}

function build(css: string): { files: { path: string; body: string }[]; barrel: string } {
  const starts = lineStarts(css);
  const files: { path: string; body: string }[] = [];
  const imports: string[] = [];
  for (let k = 0; k < SECTIONS.length; k++) {
    const s = SECTIONS[k];
    const endLineExclusive = k + 1 < SECTIONS.length ? SECTIONS[k + 1].start : TOTAL_LINES + 1;
    const from = starts[s.start];
    const to = starts[endLineExclusive]; // char index of the next section's first line (or EOF)
    const body = css.slice(from, to);
    const num = String(k + 1).padStart(2, "0");
    const rest = s.slug.startsWith(`${s.layer}-`) ? s.slug.slice(s.layer.length + 1) : s.slug;
    const name = `${num}-${s.layer}-${rest}.css`;
    files.push({ path: join(OUT_DIR, name), body });
    imports.push(`@import "./app/${name}";`);
  }
  const header =
    "/* AUTO-GENERATED by scripts/split-app-css.ts — do not edit this barrel.\n" +
    " *\n" +
    " * This is the vendored Obsidian app.css, decomposed into design-framework\n" +
    " * partials under ./app/ and re-imported in exact source (cascade) order.\n" +
    " * The concatenation of the partials is byte-identical to the original\n" +
    " * artifact (guarded by src/styles/app-split.test.ts). Edit the partials, or\n" +
    " * re-run `bun scripts/split-app-css.ts` after re-vendoring app.css.\n" +
    " *\n" +
    " * Layers, in cascade order: vendor (pdf.js) -> foundations -> shell/editor/\n" +
    " * components/settings (interleaved as Obsidian's SCSS imports them) ->\n" +
    " * plugins & views -> platform (mobile).\n" +
    " */\n";
  return { files, barrel: header + imports.join("\n") + "\n" };
}

function reassemble(files: { path: string; body: string }[]): string {
  return files.map((f) => f.body).join("");
}

// --- run -------------------------------------------------------------------
const checkOnly = process.argv.includes("--check");
const sourcePath = SOURCES.find((p) => existsSync(p));
if (!sourcePath) throw new Error(`No source app.css found in: ${SOURCES.join(", ")}`);
const css = readFileSync(sourcePath, "utf8");

validate(css);
const { files, barrel } = build(css);

const reassembled = reassemble(files);
const reSha = sha256(reassembled);
if (reSha !== GOLDEN_SHA256) {
  throw new Error(`Reassembly mismatch: partials do not concatenate back to the original.\n  got ${reSha}`);
}

console.log(`source: ${sourcePath} (sha ${GOLDEN_SHA256.slice(0, 12)}…)`);
console.log(`sections: ${files.length}, reassembly: byte-identical ✓`);

if (checkOnly) {
  console.log("--check: no files written.");
} else {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of files) writeFileSync(f.path, f.body);
  writeFileSync(BARREL, barrel);
  console.log(`wrote ${files.length} partials to ${OUT_DIR}/ and rewrote ${BARREL} as an @import barrel.`);
}
