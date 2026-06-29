import type { App } from "../app/App";
import type { ApiDocPage } from "./ApiDocModel";

export class ApiDocGenerator {
  constructor(readonly app: App) {}

  generatePluginApiPage(): ApiDocPage {
    return {
      title: "Plugin API",
      namespaces: [
        {
          name: "workspace",
          description: "Layout tree, leaves, views, editor state and workspace events.",
          methods: [
            { name: "registerView", description: "Registers a new view factory." },
            { name: "getLeaf", description: "Gets or creates a workspace leaf." },
            { name: "registerHoverLinkSource", description: "Adds a hover-preview source." },
          ],
        },
        {
          name: "markdown",
          description: "Markdown rendering, code block processors and editor extensions.",
          methods: [
            { name: "registerMarkdownPostProcessor", description: "Runs after markdown is rendered." },
            { name: "registerMarkdownCodeBlockProcessor", description: "Handles fenced code blocks by language." },
            { name: "registerEditorExtension", description: "Adds a CodeMirror-shaped editor extension." },
          ],
        },
        {
          name: "appearance",
          description: "Themes, CSS snippets and settings sections.",
          methods: [
            { name: "registerTheme", description: "Registers CSS variable based theme metadata." },
            { name: "registerCss", description: "Injects plugin CSS with lifecycle cleanup." },
            { name: "registerCssSnippet", description: "Adds a snippet to the appearance layer." },
          ],
        },
      ],
    };
  }

  renderMarkdown(page: ApiDocPage): string {
    const lines = [`# ${page.title}`, ""];
    for (const ns of page.namespaces) {
      lines.push(`## ${ns.name}`, "", ns.description, "");
      for (const method of ns.methods) lines.push(`- \`${method.name}\`: ${method.description}`);
      lines.push("");
    }
    return lines.join("\n");
  }
}
