import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { Setting, SettingGroup } from "../ui/Setting";
import type { HoverLinkSource } from "../views/workspace/WorkspaceHover";
import { setIcon } from "../ui/Icon";

export type PagePreviewOverrides = Record<string, boolean>;

export interface HoverLinkEvent {
  event?: MouseEvent;
  source: string;
  hoverParent?: unknown;
  targetEl?: HTMLElement | null;
  linktext: string;
  sourcePath?: string;
  state?: unknown;
}

const DEFAULT_HOVER_SOURCES: HoverLinkSource[] = [
  { id: "search", display: "Search", defaultMod: true },
  { id: "preview", display: "Preview", defaultMod: false },
  { id: "editor", display: "Editor", defaultMod: true },
  { id: "tab-header", display: "Tab headers", defaultMod: true },
];

export class PagePreviewController {
  overrides: PagePreviewOverrides = {};
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    this.ensureDefaultSources();
    this.overrides = { ...(await plugin.loadData<PagePreviewOverrides>()) };
    plugin.registerEvent(
      this.app.workspace.on(
        "hover-link",
        (event) => void this.onHoverLink(event as HoverLinkEvent),
      ),
    );
    plugin.addSettingTab(new PagePreviewSettingTab(this.app, this));
    const unfoldProperties = this.app.loadLocalStorage<boolean>("page-preview-unfold-properties");
    if (unfoldProperties == null)
      this.app.saveLocalStorage("page-preview-unfold-properties", false);
  }

  async onHoverLink(event: HoverLinkEvent): Promise<void> {
    if (!event.linktext) return;
    const source = this.app.workspace.hoverLinkSources.get(event.source);
    const requiresMod = this.overrides[event.source] ?? source?.defaultMod ?? true;
    if (requiresMod && !hasMod(event.event)) return;
    const targetEl = event.targetEl;
    if (!targetEl) return;
    await this.app.hoverPreview.show(
      {
        source: event.source,
        linktext: event.linktext,
        sourcePath: event.sourcePath ?? "",
        state: event.state,
        event: event.event,
      },
      targetEl,
    );
  }

  async setOverride(source: HoverLinkSource, value: boolean): Promise<void> {
    if (value === Boolean(source.defaultMod)) delete this.overrides[source.id];
    else this.overrides[source.id] = value;
    await this.plugin?.saveData(this.overrides);
  }

  private ensureDefaultSources(): void {
    for (const source of DEFAULT_HOVER_SOURCES) {
      if (!this.app.workspace.hoverLinkSources.get(source.id)) {
        this.app.workspace.registerHoverLinkSource(source.id, {
          display: source.display,
          defaultMod: source.defaultMod,
        });
      }
    }
  }
}

class PagePreviewSettingTab implements SettingTab {
  readonly id = "page-preview";
  readonly name = "Page preview";
  readonly icon = "scan-eye";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(
    readonly app: App,
    readonly controller: PagePreviewController,
  ) {
    this.navEl.className = "vertical-tab-nav-item tappable";
    const iconEl = document.createElement("div");
    iconEl.className = "vertical-tab-nav-item-icon";
    setIcon(iconEl, this.icon);
    const titleEl = document.createElement("div");
    titleEl.className = "vertical-tab-nav-item-title";
    titleEl.textContent = this.name;
    const chevronEl = document.createElement("div");
    chevronEl.className = "vertical-tab-nav-item-chevron";
    this.navEl.append(iconEl, titleEl, chevronEl);
    this.containerEl.className = "vertical-tab-content page-preview-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading(
      "Require Mod key to trigger preview",
    );
    for (const source of this.app.workspace.hoverLinkSources.list()) {
      const value = Object.hasOwn(this.controller.overrides, source.id)
        ? this.controller.overrides[source.id]
        : Boolean(source.defaultMod);
      new Setting(group.itemsEl)
        .setName(source.display)
        .setDesc(source.id)
        .addToggle((toggle) =>
          toggle.setValue(value).onChange((next) => {
            void this.controller.setOverride(source, next).then(() => this.display());
          }),
        );
    }
  }

  hide(): void {
    this.containerEl.remove();
  }
}

function hasMod(event: MouseEvent | undefined): boolean {
  return Boolean(event?.metaKey || event?.ctrlKey);
}

export function createPagePreviewPluginDefinition(): InternalPluginDefinition {
  let controller: PagePreviewController | null = null;
  return {
    id: "page-preview",
    name: "Page preview",
    description: "Preview internal links in hover popovers.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new PagePreviewController(app);
      plugin.instance = controller;
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
  };
}
