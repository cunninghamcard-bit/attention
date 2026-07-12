import { stringify as stringifyYaml } from "yaml";
import type { App } from "../../../app/App";
import { alphaCompare } from "../Cli";
import { getAllTags, parseFrontMatterAliases } from "../../../metadata/FrontmatterTags";
import type { PropertyType } from "../../../views/properties/PropertyTypes";

/**
 * The metadata CLI command batch — tags, properties, and aliases, reconstructed
 * from real Obsidian's registrations (ids, flags, output shapes, and error
 * strings verbatim). Errors are thrown as plain strings for the bridge to wrap.
 */

export function registerMetadataCommands(app: App): void {
  const cli = app.cli;

  cli.registerHandler(
    "tags",
    "List tags in the vault",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      total: { description: "Return tag count" },
      counts: { description: "Include tag counts" },
      sort: { value: "count", description: "Sort by count (default: name)" },
      format: { value: "json|tsv|csv", description: "Output format (default: tsv)" },
      active: { description: "Show tags for active file" },
    },
    (params) => {
      let entries: Array<[string, number]>;
      if (params.active || params.file || params.path) {
        const file = cli.tryResolveFile(params);
        const counts: Record<string, number> = {};
        for (const tag of getAllTags(app.metadataCache.getFileCache(file)) ?? [])
          counts[tag] = (counts[tag] ?? 0) + 1;
        entries = Object.entries(counts);
      } else {
        entries = Object.entries(app.metadataCache.getTags());
      }
      if (params.total) return String(entries.length);
      if (entries.length === 0) return "No tags found.";
      if (params.sort === "count") entries.sort((a, b) => b[1] - a[1]);
      else entries.sort((a, b) => alphaCompare(a[0], b[0]));
      const headers = params.counts ? ["tag", "count"] : ["tag"];
      const rows = entries.map(([tag, count]) => (params.counts ? [tag, String(count)] : [tag]));
      return cli.formatTable(headers, rows, params.format);
    },
  );

  cli.registerHandler(
    "tag",
    "Get tag info",
    {
      name: { value: "<tag>", description: "Tag name", required: true },
      total: { description: "Return occurrence count" },
      verbose: { description: "Include file list and count" },
    },
    (params) => {
      // Backstop; the dispatcher's required-flag check normally fires first.
      if (!params.name) throw "Missing required parameter: name\nUsage: tag name=<tag>";
      const name = String(params.name);
      const tag = name.startsWith("#") ? name : `#${name}`;
      // Case-SENSITIVE lookup against getTags()'s canonical casings, but the
      // file scan below matches case-insensitively — both faithful.
      const count = app.metadataCache.getTags()[tag];
      if (count === undefined) throw `Tag "${tag}" not found.`;
      if (params.total) return String(count);
      const paths: string[] = [];
      for (const file of app.vault.getMarkdownFiles()) {
        const tags = getAllTags(app.metadataCache.getFileCache(file)) ?? [];
        if (tags.some((item) => item.toLowerCase() === tag.toLowerCase())) paths.push(file.path);
      }
      paths.sort(alphaCompare);
      return params.verbose ? `${tag}\t${count}\n${paths.join("\n")}` : paths.join("\n");
    },
  );

  cli.registerHandler(
    "properties",
    "List properties in the vault",
    {
      file: { value: "<name>", description: "Show properties for file" },
      path: { value: "<path>", description: "Show properties for path" },
      name: { value: "<name>", description: "Get specific property count" },
      total: { description: "Return property count" },
      sort: { value: "count", description: "Sort by count (default: name)" },
      counts: { description: "Include occurrence counts" },
      format: { value: "yaml|json|tsv", description: "Output format (default: yaml)" },
      active: { description: "Show properties for active file" },
    },
    (params) => {
      if (params.active || params.file || params.path) {
        const file = cli.tryResolveFile(params);
        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        if (!frontmatter || Object.keys(frontmatter).length === 0) return "No frontmatter found.";
        if (params.format === "json") return JSON.stringify(frontmatter, null, 2);
        if (params.format === "tsv") {
          const lines: string[] = [];
          for (const [key, value] of Object.entries(frontmatter)) {
            if (value === null || value === undefined) continue;
            lines.push(Array.isArray(value) ? `${key}\t${value.join(", ")}` : `${key}\t${value}`);
          }
          return lines.join("\n");
        }
        return stringifyYaml(frontmatter, {
          nullStr: "",
          lineWidth: 0,
          aliasDuplicateObjects: false,
        }).trim();
      }
      // Vault mode — format=yaml/tsv have no effect here (reference behavior).
      const all = app.metadataTypeManager.getAllProperties();
      if (params.name) {
        const entry = all[String(params.name).toLowerCase()];
        if (!entry) throw `Property "${params.name}" not found.`;
        return String(entry.occurrences);
      }
      const list = Object.values(all);
      if (params.total) return String(list.length);
      if (params.sort === "count") list.sort((a, b) => b.occurrences - a.occurrences);
      else list.sort((a, b) => alphaCompare(a.name, b.name));
      if (params.format === "json") {
        return JSON.stringify(
          list.map((entry) => ({ name: entry.name, type: entry.widget, count: entry.occurrences })),
          null,
          2,
        );
      }
      if (params.counts)
        return list.map((entry) => `${entry.name}\t${entry.occurrences}`).join("\n");
      return list.map((entry) => entry.name).join("\n");
    },
  );

  cli.registerHandler(
    "property:read",
    "Read a property value from a file",
    {
      name: { value: "<name>", description: "Property name", required: true },
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
    },
    (params) => {
      if (!params.name) throw "Missing required parameter: name";
      const file = cli.tryResolveFile(params);
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) throw `Property "${params.name}" not found.`;
      // Exact-case key access (unlike the vault-wide lowercased property map).
      const value = frontmatter[String(params.name)];
      if (value === undefined) throw `Property "${params.name}" not found.`;
      if (Array.isArray(value)) return value.length > 0 ? value.join("\n") : "(empty)";
      if (value === "" || value === null) return "(empty)";
      return String(value);
    },
  );

  cli.registerHandler(
    "property:set",
    "Set a property on a file",
    {
      name: { value: "<name>", description: "Property name", required: true },
      value: { value: "<value>", description: "Property value", required: true },
      type: { value: "text|list|number|checkbox|date|datetime", description: "Property type" },
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
    },
    async (params) => {
      if (!params.name) throw "Missing required parameter: name";
      const file = cli.tryResolveFile(params);
      const raw = String(params.value ?? "");
      let type = params.type;
      let parsed: unknown = raw;
      // The JSON-array branch wins regardless of the type flag (reference
      // precedence): a failed or non-array parse keeps the raw string.
      if (raw.startsWith("[") && raw.endsWith("]")) {
        try {
          const json = JSON.parse(raw);
          if (Array.isArray(json)) {
            parsed = json;
            if (!type) type = "list";
          }
        } catch {
          // Not JSON — keep the raw string.
        }
      } else if (type === "number") {
        parsed = Number(raw);
        if (Number.isNaN(parsed)) throw `Invalid number: ${raw}`;
      } else if (type === "checkbox") {
        parsed = raw === "true" || raw === "1";
      } else if (type === "list") {
        parsed = raw.split(",").map((item) => item.trim());
      } else if (type === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw "Invalid date format. Use YYYY-MM-DD";
      } else if (type === "datetime") {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
          throw "Invalid datetime format. Use YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss";
        }
      }
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter[String(params.name)] = parsed as never;
      });
      if (type)
        app.metadataTypeManager.setType(
          String(params.name),
          (type === "list" ? "multitext" : type) as PropertyType,
        );
      // Echoes the raw input string, not the parsed representation.
      return `Set ${params.name}: ${raw}`;
    },
  );

  cli.registerHandler(
    "property:remove",
    "Remove a property from a file",
    {
      name: { value: "<name>", description: "Property name", required: true },
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
    },
    async (params) => {
      if (!params.name) throw "Missing required parameter: name";
      const file = cli.tryResolveFile(params);
      // No existence check — reports "Removed:" even for an absent key.
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        delete frontmatter[String(params.name)];
      });
      return `Removed: ${params.name}`;
    },
  );

  cli.registerHandler(
    "aliases",
    "List aliases in the vault",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      total: { description: "Return alias count" },
      verbose: { description: "Include file paths" },
      active: { description: "Show aliases for active file" },
    },
    (params) => {
      if (params.active || params.file || params.path) {
        const file = cli.tryResolveFile(params);
        const aliases =
          parseFrontMatterAliases(app.metadataCache.getFileCache(file)?.frontmatter) ?? [];
        if (params.total) return String(aliases.length);
        if (aliases.length === 0) return "No aliases found.";
        return aliases.sort(alphaCompare).join("\n");
      }
      const byAlias = new Map<string, string[]>();
      for (const file of app.vault.getMarkdownFiles()) {
        for (const alias of parseFrontMatterAliases(
          app.metadataCache.getFileCache(file)?.frontmatter,
        ) ?? []) {
          const paths = byAlias.get(alias) ?? [];
          paths.push(file.path);
          byAlias.set(alias, paths);
        }
      }
      if (params.total) return String(byAlias.size);
      if (byAlias.size === 0) return "No aliases found.";
      const entries = [...byAlias.entries()].sort((a, b) => alphaCompare(a[0], b[0]));
      return params.verbose
        ? entries.map(([alias, paths]) => `${alias}\t${paths.join(", ")}`).join("\n")
        : entries.map(([alias]) => alias).join("\n");
    },
  );
}
