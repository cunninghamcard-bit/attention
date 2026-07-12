import type { App } from "../../../app/App";
import type { InternalPluginWrapper } from "../../../plugin/InternalPluginWrapper";
import { splitLinkpath } from "../../../metadata/Linkpath";

/**
 * Internal-plugin CLI batch: `links` (carried by the Outgoing Links plugin)
 * and `outline` (carried by the Outline plugin). Both are pure metadataCache
 * reads — no tabs opened, no clipboard, no mutations. Resolver errors are
 * THROWN plain strings (the bridge renders them as `Error: ...`);
 * "No links found." / "No headings found." are RETURNED text.
 */

interface TreeNode {
  label: string;
  children: TreeNode[];
}

export function registerLinksCliHandlers(plugin: InternalPluginWrapper): void {
  const app = plugin.app;
  plugin.registerCliHandler(
    "links",
    "List outgoing links from a file",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      total: { description: "Return link count" },
    },
    (params) => {
      const file = app.cli.tryResolveFile(params);
      const cache = app.metadataCache.getFileCache(file);
      if (!cache) return "No links found.";
      const results = new Set<string>();
      // Frontmatter links, then inline links, then embeds — the real walk
      // order. Subpaths (`#...`) are stripped before resolving; resolution is
      // relative to the source file; unresolved links keep the raw linkpath.
      for (const refs of [cache.frontmatterLinks, cache.links, cache.embeds]) {
        for (const ref of refs ?? []) {
          const linkpath = splitLinkpath(ref.link).path;
          const dest = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
          results.add(dest ? dest.path : `${linkpath} (unresolved)`);
        }
      }
      // total is checked before the empty case (faithful): 0 links → "0".
      if (params.total) return String(results.size);
      if (results.size === 0) return "No links found.";
      return Array.from(results).sort().join("\n");
    },
  );
}

export function registerOutlineCliHandlers(plugin: InternalPluginWrapper): void {
  const app = plugin.app;
  plugin.registerCliHandler(
    "outline",
    "Show headings for the current file",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      format: { value: "tree|md|json", description: "Output format (default: tree)" },
      total: { description: "Return heading count" },
    },
    (params) => {
      const file = app.cli.tryResolveFile(params);
      if (file.extension !== "md") throw "File is not a markdown file.";
      const headings = app.metadataCache.getFileCache(file)?.headings;
      // Faithful asymmetry with `links`: the empty check runs BEFORE total,
      // so a heading-less file returns "No headings found." even with total.
      if (!headings || headings.length === 0) return "No headings found.";
      if (params.total) return String(headings.length);
      if (params.format === "json") {
        return JSON.stringify(
          headings.map((h) => ({ level: h.level, heading: h.heading, line: h.position.start.line + 1 })),
          null,
          2,
        );
      }
      if (params.format === "md") return headings.map((h) => `${"#".repeat(h.level)} ${h.heading}`).join("\n");
      // Any other format value (including "tree") falls through to the tree —
      // the real handler has no format validation. Stack-built forest: pop
      // while the top's level >= this heading's level, then attach.
      const roots: TreeNode[] = [];
      const stack: Array<{ node: TreeNode; level: number }> = [];
      for (const heading of headings) {
        const node: TreeNode = { label: heading.heading, children: [] };
        while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop();
        if (stack.length === 0) roots.push(node);
        else stack[stack.length - 1].node.children.push(node);
        stack.push({ node, level: heading.level });
      }
      return app.cli.formatAsciiTree(roots);
    },
  );
}
