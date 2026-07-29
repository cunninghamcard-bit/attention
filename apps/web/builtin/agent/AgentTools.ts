/**
 * Input: ../../app/App, ../../vault/TAbstractFile, @earendil-works/pi-agent-core, @earendil-works/pi-ai
 * Output: createVaultTools
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { App } from "../../app/App";
import { TFile, TFolder } from "../../vault/TAbstractFile";

/** Keep listings and search results inside a sane prompt budget. */
const MAX_RESULTS = 200;
const MAX_MATCHES = 40;

function result(text: string): AgentToolResult<Record<string, never>> {
  return { content: [{ type: "text", text }], details: {} };
}

function requireFile(app: App, path: string): TFile {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error(`No note at "${path}"`);
  return file;
}

/**
 * The agent's hands: the vault, and nothing else.
 *
 * pi ships a filesystem/shell harness (`@earendil-works/pi-agent-core`
 * harness tools) written for a Node process with a real cwd. In the renderer
 * the vault IS the filesystem, so these four tools speak vault paths and route
 * every read and write back through `Vault` — that is what keeps the
 * MetadataCache, the file watchers and any open editor in step with what the
 * model just did. A tool that touched disk directly would leave all three
 * stale.
 */
export function createVaultTools(app: App): AgentTool[] {
  const listNotes: AgentTool<typeof listParams> = {
    name: "list_notes",
    label: "List notes",
    description:
      "List note paths in the vault, optionally restricted to a folder. Use this to discover what exists before reading.",
    parameters: listParams,
    executionMode: "parallel",
    async execute(_id, params) {
      const prefix = normalizeFolder(params.folder);
      const paths = app.vault
        .getMarkdownFiles()
        .map((file) => file.path)
        .filter((path) => prefix === "" || path.startsWith(prefix))
        .sort();
      if (paths.length === 0)
        return result(prefix ? `No notes under "${prefix}".` : "Empty vault.");
      const shown = paths.slice(0, MAX_RESULTS);
      const more = paths.length - shown.length;
      return result(shown.join("\n") + (more > 0 ? `\n… ${more} more` : ""));
    },
  };

  const readNote: AgentTool<typeof pathParams> = {
    name: "read_note",
    label: "Read note",
    description: "Read the full markdown source of one note, addressed by its vault path.",
    parameters: pathParams,
    executionMode: "parallel",
    async execute(_id, params) {
      return result(await app.vault.read(requireFile(app, params.path)));
    },
  };

  const writeNote: AgentTool<typeof writeParams> = {
    name: "write_note",
    label: "Write note",
    // Sequential: two concurrent writes to the same path would race the vault's
    // read-modify-write, and the model has no way to know they collide.
    executionMode: "sequential",
    description:
      "Create a note or replace its entire contents. Read the note first when editing — this overwrites, it does not patch.",
    parameters: writeParams,
    async execute(_id, params) {
      const existing = app.vault.getAbstractFileByPath(params.path);
      if (existing instanceof TFolder) throw new Error(`"${params.path}" is a folder`);
      if (existing instanceof TFile) {
        await app.vault.modify(existing, params.content);
        return result(`Updated ${params.path}`);
      }
      await app.vault.create(params.path, params.content);
      return result(`Created ${params.path}`);
    },
  };

  const searchNotes: AgentTool<typeof queryParams> = {
    name: "search_notes",
    label: "Search notes",
    description:
      "Case-insensitive plain-text search across every note. Returns matching paths with the first matching line.",
    parameters: queryParams,
    executionMode: "parallel",
    async execute(_id, params) {
      const needle = params.query.toLowerCase();
      if (!needle) throw new Error("query must not be empty");
      const matches: string[] = [];
      for (const file of app.vault.getMarkdownFiles()) {
        if (matches.length >= MAX_MATCHES) break;
        // cachedRead: search reads the whole vault, and the cache is exactly
        // what it is for — the uncached path re-hits disk per file.
        const content = await app.vault.cachedRead(file);
        const line = content
          .split("\n")
          .find((candidate) => candidate.toLowerCase().includes(needle));
        if (line !== undefined) matches.push(`${file.path}: ${line.trim()}`);
      }
      return result(matches.length > 0 ? matches.join("\n") : `No note matches "${params.query}".`);
    },
  };

  return [listNotes, readNote, writeNote, searchNotes];
}

const listParams = Type.Object({
  folder: Type.Optional(
    Type.String({ description: "Vault-relative folder path. Omit to list the whole vault." }),
  ),
});

const pathParams = Type.Object({
  path: Type.String({ description: 'Vault-relative path, e.g. "Projects/Roadmap.md".' }),
});

const writeParams = Type.Object({
  path: Type.String({ description: 'Vault-relative path, e.g. "Projects/Roadmap.md".' }),
  content: Type.String({ description: "The complete new markdown source of the note." }),
});

const queryParams = Type.Object({
  query: Type.String({ description: "Plain text to look for. Not a regular expression." }),
});

function normalizeFolder(folder: string | undefined): string {
  const trimmed = (folder ?? "").replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "" : `${trimmed}/`;
}
