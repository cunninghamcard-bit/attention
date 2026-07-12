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
  [id: string]:
    | HoverLinkSourceConfig
    | ((idOrSource: string | HoverLinkSource, config?: HoverLinkSourceConfig) => void)
    | ((id: string) => void)
    | ((id: string) => HoverLinkSource | null)
    | (() => readonly HoverLinkSource[]);

  register(source: HoverLinkSource): void;
  register(id: string, config: HoverLinkSourceConfig): void;
  register(idOrSource: string | HoverLinkSource, config?: HoverLinkSourceConfig): void {
    if (typeof idOrSource === "string") {
      this[idOrSource] = config ?? { display: idOrSource };
      return;
    }
    const { id, ...sourceConfig } = idOrSource;
    this[id] = sourceConfig;
  }

  unregister(id: string): void {
    delete this[id];
  }

  get(id: string): HoverLinkSource | null {
    const config = this[id];
    return isHoverLinkSourceConfig(config) ? { id, ...config } : null;
  }

  list(): readonly HoverLinkSource[] {
    const sources: HoverLinkSource[] = [];
    for (const [id, config] of Object.entries(this)) {
      if (isHoverLinkSourceConfig(config)) sources.push({ id, ...config });
    }
    return sources;
  }
}

function isHoverLinkSourceConfig(value: unknown): value is HoverLinkSourceConfig {
  return Boolean(value && typeof value === "object" && "display" in value);
}
