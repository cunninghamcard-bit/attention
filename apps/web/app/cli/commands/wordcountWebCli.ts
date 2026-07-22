import type { InternalPluginWrapper } from "../../../plugin/InternalPluginWrapper";
import { countWords, stripFrontmatter } from "../../../builtin/WordCount";

/**
 * Internal-plugin CLI batch: `wordcount` (carried by the word-count plugin)
 * and `web` (carried by the webviewer plugin). Command ids, descriptions,
 * flags, output shapes, and error strings are verbatim from real Obsidian.
 */

export function registerWordCountCliHandlers(plugin: InternalPluginWrapper): void {
  const app = plugin.app;
  plugin.registerCliHandler(
    "wordcount",
    "Count words and characters",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      words: { description: "Return word count only" },
      characters: { description: "Return character count only" },
    },
    async (params) => {
      const file = app.cli.tryResolveFile(params);
      // Extension gate runs before any read, active-file fallback included.
      if (file.extension !== "md") throw "Word count is only available for markdown files.";
      const text = stripFrontmatter(await app.vault.cachedRead(file));
      const words = countWords(text).words;
      // Faithful: characters = UTF-16 length of the frontmatter-stripped text
      // (whitespace included) — NOT the status bar's whitespace-free count.
      const characters = text.length;
      if (params.words && !params.characters) return String(words);
      if (params.characters && !params.words) return String(characters);
      return `words: ${words}\ncharacters: ${characters}`;
    },
  );
}

export function registerWebCliHandlers(plugin: InternalPluginWrapper): void {
  const app = plugin.app;
  plugin.registerCliHandler(
    "web",
    "Open URL in web viewer",
    {
      url: { value: "<url>", description: "URL to open", required: true },
      newtab: { description: "Open in new tab" },
    },
    (params) => {
      // Redundant with required:true, but the real handler guards manually too.
      if (!params.url) throw "Missing required parameter: url\nUsage: web url=<url>";
      let url = String(params.url);
      if (!url.includes("://")) url = "https://" + url;
      // Real openUrl: newtab → new tab leaf, else replace the active leaf's
      // view. Fire-and-forget — the real handler is synchronous, and it
      // null-guards the leaf (null==i||i.setViewState(...)).
      const leaf = app.workspace.getLeaf(Boolean(params.newtab));
      void leaf?.setViewState({
        type: "webviewer",
        active: true,
        state: { url, title: url, navigate: true },
      });
      return `Opened: ${url}`;
    },
  );
}
