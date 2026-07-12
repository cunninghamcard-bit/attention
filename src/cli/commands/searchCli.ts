import type { App } from "../../app/App";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";

/**
 * The `global-search` core plugin's CLI lane — `search`, `search:context`,
 * and `search:open`, reconstructed from the handlers real Obsidian registers
 * in the plugin's onEnable.
 */

interface CliSearchMatch {
  line: number;
  text: string;
}

interface CliSearchResult {
  file: string;
  matches: CliSearchMatch[];
}

// Plain (non-operator) words of a query, mirroring the engine parser's
// tokenizer (parseSearchQuery is module-private): `[property]` and known
// `operator:` tokens are not words; an unknown prefix stays a plain word.
function plainWords(app: App, query: string): string[] {
  const operators = new Set(["path", "file", "tag", "line", "section", ...app.search.getRegisteredOperators().map((op) => op.name)]);
  const words: string[] = [];
  for (const token of query.matchAll(/(\[[^\]]+\])|(\w+):(?:\([^)]*\)|"[^"]*"|\S*)|"([^"]*)"|(\S+)/g)) {
    const [full, property, operator, quoted, plain] = token;
    if (property !== undefined) continue;
    if (operator !== undefined) {
      if (!operators.has(operator)) words.push(full);
      continue;
    }
    const word = quoted ?? plain;
    if (word) words.push(word);
  }
  return words;
}

// The shared search closure (real `i(query, path, caseSensitive)`), mapped
// onto our SearchEngine. Divergence forced by the engine: its parser cannot
// fail, so the real 'Invalid search query.' throw is unreachable.
async function searchVault(app: App, query: string, path: string | undefined, caseSensitive: boolean): Promise<CliSearchResult[]> {
  const pathPrefix = path ? (path.endsWith("/") ? path : `${path}/`) : undefined;
  // The engine sorts results by path; real output is vault traversal order,
  // so reorder by iterating getMarkdownFiles() (which also drops the engine's
  // non-markdown hits, as the real helper never reads them).
  const engineResults = new Map((await app.search.search({ query, caseSensitive, pathPrefix })).map((result) => [result.path, result]));
  const fold = (text: string) => (caseSensitive ? text : text.toLowerCase());
  const words = plainWords(app, fold(query.trim()));
  const results: CliSearchResult[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (pathPrefix && !file.path.startsWith(pathPrefix)) continue;
    // The real helper honors the Excluded-files setting; the engine does not.
    if (app.metadataCache.isUserIgnored(file.path)) continue;
    const result = engineResults.get(file.path);
    if (result) {
      // Real output shape: 1-based line numbers with trimmed line text (engine
      // matches are 0-based and carry the raw line).
      results.push({ file: file.path, matches: result.matches.map((match) => ({ line: match.line + 1, text: match.text.trim() })) });
    } else if (words.length > 0 && words.every((word) => fold(file.name).includes(word))) {
      // Real BH also matches plain words against the file name; a filename-only
      // hit has no content offsets, so it surfaces as a bare-path entry.
      // Approximation: real BH evaluates the whole query jointly against
      // filename+content; we require a content match or all plain words in the name.
      results.push({ file: file.path, matches: [] });
    }
  }
  return results;
}

export function registerSearchCliHandlers(plugin: InternalPluginWrapper): void {
  const app = plugin.app;

  plugin.registerCliHandler(
    "search",
    "Search vault for text",
    {
      query: { value: "<text>", description: "Search query", required: true },
      path: { value: "<folder>", description: "Limit to folder" },
      limit: { value: "<n>", description: "Max files" },
      total: { description: "Return match count" },
      case: { description: "Case sensitive" },
      format: { value: "text|json", description: "Output format (default: text)" },
    },
    async (args) => {
      if (!args.query) throw "Missing required parameter: query";
      const results = await searchVault(app, args.query, args.path, !!args.case);
      const n = args.limit ? parseInt(args.limit, 10) : 0;
      // total counts matched files and ignores limit.
      if (args.total) return args.format === "json" ? JSON.stringify({ total: results.length }) : String(results.length);
      // The empty check precedes the format check: json also gets this text.
      if (results.length === 0) return "No matches found.";
      let paths = results.map((result) => result.file);
      if (n > 0) paths = paths.slice(0, n);
      return args.format === "json" ? JSON.stringify(paths) : paths.join("\n");
    },
  );

  plugin.registerCliHandler(
    "search:context",
    "Search with matching line context",
    {
      query: { value: "<text>", description: "Search query", required: true },
      path: { value: "<folder>", description: "Limit to folder" },
      limit: { value: "<n>", description: "Max files" },
      case: { description: "Case sensitive" },
      format: { value: "text|json", description: "Output format (default: text)" },
    },
    async (args) => {
      if (!args.query) throw "Missing required parameter: query";
      let results = await searchVault(app, args.query, args.path, !!args.case);
      const n = args.limit ? parseInt(args.limit, 10) : 0;
      if (results.length === 0) return "No matches found.";
      // limit caps file entries, not match lines.
      if (n > 0) results = results.slice(0, n);
      if (args.format === "json") return JSON.stringify(results);
      const lines: string[] = [];
      for (const result of results) {
        // A match without content offsets (e.g. filename-only) is a bare path line.
        if (result.matches.length === 0) lines.push(result.file);
        else for (const match of result.matches) lines.push(`${result.file}:${match.line}: ${match.text}`);
      }
      return lines.join("\n");
    },
  );

  plugin.registerCliHandler(
    "search:open",
    "Open search view",
    { query: { value: "<text>", description: "Initial search query" } },
    (args) => {
      // Real openGlobalSearch is fire-and-forget; the handler stays synchronous.
      void app.workspace.ensureSideLeaf("search", "left", { active: true, reveal: true, state: { query: args.query || "" } });
      return args.query ? `Opened search: ${args.query}` : "Opened search";
    },
  );
}
