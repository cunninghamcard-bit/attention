import type { App } from "../app/App";

export interface EmbedContext {
  app: App;
  sourcePath: string;
  target: string;
}

export class MarkdownEmbedRenderer {
  async renderEmbed(context: EmbedContext, container: HTMLElement): Promise<void> {
    const file = context.app.metadataCache.getFirstLinkpathDest(context.target, context.sourcePath);
    container.classList.add("markdown-embed");
    if (!file) {
      container.textContent = `Missing embed: ${context.target}`;
      return;
    }
    container.dataset.path = file.path;
    container.textContent = `Embedded: ${file.path}`;
  }
}
