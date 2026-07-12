import type { App } from "../app/App";
import type { TFile } from "../vault/TAbstractFile";

export interface LinktextResult {
  path: string;
  subpath?: string;
}

export class MarkdownLinkResolver {
  constructor(readonly app: App) {}

  parseLinktext(linktext: string): LinktextResult {
    const [withoutAlias] = linktext.split("|", 1);
    const [path, subpath] = withoutAlias.split("#", 2);
    return { path: path.trim(), ...(subpath ? { subpath: subpath.trim() } : {}) };
  }

  resolve(linktext: string, sourcePath: string): TFile | null {
    const result = this.parseLinktext(linktext);
    return this.app.metadataCache.getFirstLinkpathDest(result.path, sourcePath);
  }

  async openLinkText(linktext: string, sourcePath: string): Promise<void> {
    await this.app.workspace.openLinkText(linktext, sourcePath, undefined, { active: true });
  }
}
