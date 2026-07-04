import type { App } from "../app/App";
import { finishRenderMath, loadMermaid, renderMath } from "../api/ApiUtils";
import { MarkdownRenderer, type MarkdownCodeBlockProcessor, type MarkdownPostProcessorContext } from "./MarkdownRenderer";

export function registerMarkdownDefaultProcessors(app: App): void {
  registerCodeBlockPostProcessor("mermaid", async (source, el) => {
    el.classList.add("block-language-mermaid", "mermaid");
    el.replaceChildren();
    try {
      const mermaid = await loadMermaid();
      const rendered = await mermaid.render(`mermaid-${hashSource(source)}`, source);
      const svg = typeof rendered === "string" ? rendered : rendered?.svg;
      if (typeof svg === "string" && svg.trim()) el.innerHTML = svg;
      else el.textContent = source;
    } catch (error) {
      el.classList.add("mod-error");
      el.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  registerCodeBlockPostProcessor("math", async (source, el) => {
    el.classList.add("block-language-math");
    el.replaceChildren(renderMath(source, true));
    await finishRenderMath();
  });

  registerCodeBlockPostProcessor("query", async (source, el) => {
    el.classList.add("block-language-query");
    el.textContent = `Search/query block placeholder:\n${source}`;
  });

  MarkdownRenderer.registerPostProcessor((root, context) => {
    for (const embed of root.querySelectorAll<HTMLElement>(".internal-embed")) {
      const target = embed.dataset.href;
      if (!target) continue;
      const file = app.metadataCache.getFirstLinkpathDest(target, context.sourcePath);
      embed.classList.toggle("is-loaded", Boolean(file));
      embed.textContent = file ? `Embedded: ${file.path}` : `Missing embed: ${target}`;
    }
  }, -10);

  MarkdownRenderer.registerPostProcessor((root) => {
    for (const paragraph of root.querySelectorAll("p")) {
      const text = paragraph.textContent ?? "";
      const callout = text.match(/^\[!(\w+)\]\s*(.*)$/);
      if (!callout) continue;
      paragraph.classList.add("callout", `callout-${callout[1].toLowerCase()}`);
      paragraph.textContent = callout[2] || callout[1];
    }
  });

  MarkdownRenderer.registerPostProcessor((root, context) => {
    app.fixFileLinks(root, context.sourcePath);
  });

  MarkdownRenderer.registerPostProcessor(addCopyCodeButtons);

  app.workspace.trigger("post-processor-change");
}

// Obsidian shows a copy button on every rendered code fence; app.css already
// ships the .copy-code-button styles. Registered as a default post-processor
// so both MarkdownView and ChatView get it.
export function addCopyCodeButtons(root: HTMLElement): void {
  // Post-processors receive each section element directly, so the root may
  // itself be the pre of a code fence.
  const pres = root instanceof HTMLPreElement ? [root] : [...root.querySelectorAll("pre")];
  for (const pre of pres) {
    const code = pre.querySelector("code");
    if (!code || pre.querySelector(".copy-code-button")) continue;
    const button = pre.ownerDocument.createElement("button");
    button.className = "copy-code-button";
    button.textContent = "Copy";
    button.addEventListener("click", () => {
      void navigator.clipboard?.writeText(code.textContent ?? "").then(() => {
        button.textContent = "Copied!";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1500);
      });
    });
    pre.appendChild(button);
  }
}

function registerCodeBlockPostProcessor(language: string, processor: MarkdownCodeBlockProcessor): void {
  const wrapper = MarkdownRenderer.createCodeBlockPostProcessor(language, processor);
  MarkdownRenderer.registerPostProcessor(wrapper);
  MarkdownRenderer.registerCodeBlockPostProcessor(language, processor);
}

function hashSource(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
