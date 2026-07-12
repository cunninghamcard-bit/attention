import type { App } from "../../app/App";
import { alphaCompare } from "../Cli";

/**
 * The graph-list CLI batch — backlinks / unresolved / orphans / deadends,
 * reconstructed verbatim from real Obsidian's CA-class handlers.
 *
 * Key asymmetries preserved from the reference: backlinks `total` SUMS link
 * occurrences; unresolved `total` counts DISTINCT link texts; orphans/deadends
 * `total` counts files. backlinks/unresolved go through formatTable (format
 * flag honored); orphans/deadends are plain "\n"-joined path lists. In every
 * command `total` is evaluated before the empty-result message, so a total of
 * 0 returns "0", never the "No ... found." text. All four are pure reads.
 */

export function registerGraphListCommands(app: App): void {
  const cli = app.cli;

  cli.registerHandler(
    "backlinks",
    "List backlinks to a file",
    {
      file: { value: "<name>", description: "Target file name" },
      path: { value: "<path>", description: "Target file path" },
      counts: { description: "Include link counts" },
      total: { description: "Return backlink count" },
      format: { value: "json|tsv|csv", description: "Output format (default: tsv)" },
    },
    (params) => {
      const target = cli.tryResolveFile(params).path;
      const resolved = app.metadataCache.resolvedLinks;
      const entries: Array<{ path: string; count: number }> = [];
      for (const source of Object.keys(resolved)) {
        if (Object.prototype.hasOwnProperty.call(resolved[source], target)) {
          entries.push({ path: source, count: resolved[source][target] });
        }
      }
      // total = SUM of link occurrences, not the number of linking files.
      if (params.total) return String(entries.reduce((sum, entry) => sum + entry.count, 0));
      if (entries.length === 0) return "No backlinks found.";
      entries.sort((a, b) => alphaCompare(a.path, b.path));
      const counts = Boolean(params.counts);
      const header = counts ? ["file", "count"] : ["file"];
      const rows = entries.map((entry) => counts ? [entry.path, String(entry.count)] : [entry.path]);
      return cli.formatTable(header, rows, params.format);
    },
  );

  cli.registerHandler(
    "unresolved",
    "List unresolved links in vault",
    {
      total: { description: "Return unresolved link count" },
      counts: { description: "Include link counts" },
      verbose: { description: "Include source files" },
      format: { value: "json|tsv|csv", description: "Output format (default: tsv)" },
    },
    (params) => {
      // Aggregate by link text; source order = object iteration (insertion)
      // order, NOT sorted.
      const byLink = new Map<string, { sources: string[]; count: number }>();
      const unresolved = app.metadataCache.unresolvedLinks;
      for (const source of Object.keys(unresolved)) {
        for (const link of Object.keys(unresolved[source])) {
          const entry = byLink.get(link);
          if (entry) {
            entry.sources.push(source);
            entry.count += unresolved[source][link];
          } else {
            byLink.set(link, { sources: [source], count: unresolved[source][link] });
          }
        }
      }
      const entries = [...byLink.entries()].map(([link, entry]) => ({ link, ...entry }));
      // total = number of DISTINCT unresolved link texts.
      if (params.total) return String(entries.length);
      if (entries.length === 0) return "No unresolved links found.";
      entries.sort((a, b) => alphaCompare(a.link, b.link));
      // verbose wins over counts when both are passed.
      const header = params.verbose ? ["link", "count", "sources"] : params.counts ? ["link", "count"] : ["link"];
      const rows = entries.map((entry) => params.verbose
        ? [entry.link, String(entry.count), entry.sources.join(", ")]
        : params.counts ? [entry.link, String(entry.count)] : [entry.link]);
      return cli.formatTable(header, rows, params.format);
    },
  );

  // `all` on orphans/deadends is declared (it shows in help) but dead in real
  // Obsidian 1.12.7 — the handlers use vault.getFiles() (every extension)
  // unconditionally and never read the flag.
  cli.registerHandler(
    "orphans",
    "List files with no incoming links",
    {
      total: { description: "Return orphan count" },
      all: { description: "Include non-markdown files" },
    },
    (params) => {
      const targets = new Set<string>();
      const resolved = app.metadataCache.resolvedLinks;
      for (const source of Object.keys(resolved)) {
        for (const target of Object.keys(resolved[source])) targets.add(target);
      }
      const orphans = app.vault.getFiles().map((file) => file.path).filter((path) => !targets.has(path));
      if (params.total) return String(orphans.length);
      if (orphans.length === 0) return "No orphan files found.";
      return orphans.sort(alphaCompare).join("\n");
    },
  );

  cli.registerHandler(
    "deadends",
    "List files with no outgoing links",
    {
      total: { description: "Return dead-end count" },
      all: { description: "Include non-markdown files" },
    },
    (params) => {
      // Only RESOLVED outgoing links count — a file whose links are all
      // unresolved is still a dead end (unresolvedLinks is not consulted).
      const resolved = app.metadataCache.resolvedLinks;
      const deadends = app.vault.getFiles().map((file) => file.path).filter((path) => {
        const links = resolved[path];
        return !links || Object.keys(links).length === 0;
      });
      if (params.total) return String(deadends.length);
      if (deadends.length === 0) return "No dead-end files found.";
      return deadends.sort(alphaCompare).join("\n");
    },
  );
}
