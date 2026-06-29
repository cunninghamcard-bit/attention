export interface HoverLinkSource {
  id: string;
  display: string;
  defaultMod?: boolean;
}

export interface HoverLinkSourceConfig {
  display: string;
  defaultMod?: boolean;
}

export class HoverLinkSourceRegistry {
  private sources = new Map<string, HoverLinkSource>();

  register(source: HoverLinkSource): void {
    this.sources.set(source.id, source);
  }

  unregister(id: string): void {
    this.sources.delete(id);
  }

  get(id: string): HoverLinkSource | null {
    return this.sources.get(id) ?? null;
  }

  list(): readonly HoverLinkSource[] {
    return [...this.sources.values()];
  }
}
