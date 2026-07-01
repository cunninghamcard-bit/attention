import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { MarkdownView } from "../views/MarkdownView";

type EditorStatus = "read" | "source" | "live-preview";

const STATUS_LABELS: Record<EditorStatus, string> = {
  read: "Reading view",
  source: "Source mode",
  "live-preview": "Live Preview",
};

const STATUS_ICONS: Record<EditorStatus, string> = {
  read: "lucide-book-open",
  source: "lucide-code-2",
  "live-preview": "lucide-edit-3",
};

export class EditorStatusController {
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  onEnable(plugin: InternalPluginWrapper): void {
    this.plugin = plugin;
    const el = plugin.statusBarEl;
    if (!el) return;
    el.classList.add("mod-clickable", "plugin-editor-status");
    el.addEventListener("click", () => void this.cycleStatus());
    plugin.registerEvent(this.app.workspace.on("layout-change", () => this.updateStatus()));
    plugin.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateStatus()));
    this.updateStatus();
  }

  getStatus(): EditorStatus | null {
    const leaf = this.app.workspace.activeLeaf;
    if (!(leaf?.view instanceof MarkdownView)) return null;
    const state = leaf.getViewState() as { state?: { mode?: string; source?: boolean } };
    if (state.state?.mode === "preview") return "read";
    if (state.state?.source === false) return "live-preview";
    return "source";
  }

  async setStatus(status: EditorStatus): Promise<void> {
    const leaf = this.app.workspace.activeLeaf;
    if (!(leaf?.view instanceof MarkdownView)) return;
    const viewState = leaf.getViewState() as { type: string; state?: Record<string, unknown> };
    const state = { ...(viewState.state ?? {}) };
    if (status === "read") {
      state.mode = "preview";
    } else if (status === "source") {
      state.mode = "source";
      state.source = true;
    } else {
      state.mode = "source";
      state.source = false;
    }
    await leaf.setViewState({ ...viewState, state, active: true });
    this.updateStatus();
  }

  async cycleStatus(): Promise<void> {
    const status = this.getStatus();
    if (!status) return;
    const next: Record<EditorStatus, EditorStatus> = {
      read: "source",
      source: "live-preview",
      "live-preview": "read",
    };
    await this.setStatus(next[status]);
  }

  updateStatus(): void {
    const el = this.plugin?.statusBarEl;
    if (!el) return;
    const status = this.getStatus();
    el.style.display = status ? "" : "none";
    if (!status) return;
    el.replaceChildren();
    const iconEl = el.ownerDocument.createElement("span");
    iconEl.className = "status-bar-item-icon";
    iconEl.dataset.icon = STATUS_ICONS[status];
    const labelEl = el.ownerDocument.createElement("span");
    labelEl.className = "status-bar-item-segment";
    labelEl.textContent = STATUS_LABELS[status];
    el.title = STATUS_LABELS[status];
    el.append(iconEl, labelEl);
  }
}

export function createEditorStatusPluginDefinition(): InternalPluginDefinition {
  let controller: EditorStatusController | null = null;
  return {
    id: "editor-status",
    name: "Editor status",
    description: "Shows and changes the active Markdown editing mode.",
    defaultOn: true,
    hiddenFromList: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new EditorStatusController(app);
      plugin.instance = controller;
      plugin.registerStatusBarItem();
    },
    onEnable(_app: App, plugin: InternalPluginWrapper) {
      controller?.onEnable(plugin);
    },
  };
}
