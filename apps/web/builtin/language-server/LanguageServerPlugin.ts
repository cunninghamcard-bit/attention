/**
 * Input: ../../app/App, ../../app/SettingRegistry, ../../plugin/InternalPlugin, ../../plugin/InternalPluginWrapper, ../../ui/Icon, ../../ui/Setting, ../../views/CodeFileView, ./LanguageServerRegistry, ./ReferencesView
 * Output: createLanguageServerPluginDefinition
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "../../app/App";
import type { SettingTab } from "../../app/SettingRegistry";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import { setIcon } from "../../ui/Icon";
import { Setting, SettingGroup } from "../../ui/Setting";
import { CodeFileView } from "../../views/CodeFileView";
import { LANGUAGE_GROUPS, getLanguageServer } from "./LanguageServerRegistry";
import { REFERENCES_VIEW_TYPE, ReferencesView } from "./ReferencesView";

/**
 * Built-in Language servers core plugin, following the Terminal plugin's
 * shape: the capability is a service on the app (`app.languageServers`); this
 * registers what the user reaches it through — commands, the References pane,
 * and a settings tab. It is for the person reading code: nothing here is an
 * agent tool, since agents have their own ways to query code.
 */

class LanguageServerSettingTab implements SettingTab {
  readonly id = "language-server";
  readonly name = "Language servers";
  readonly icon = "lucide-braces";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(readonly app: App) {
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
    this.containerEl.className = "vertical-tab-content language-server-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const service = this.app.languageServers;
    const settings = service.getSettings();

    const general = new SettingGroup(this.containerEl).setHeading("Language servers");
    new Setting(general.itemsEl)
      .setName("Use language servers")
      .setDesc(
        "Go to definition, find references and hover in code files. A server starts when " +
          "you open a file of its language and stops a few minutes after the last one closes.",
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange((enabled) => {
          service.saveSettings({ enabled });
          this.display();
        }),
      );
    new Setting(general.itemsEl)
      .setName("Use servers installed in the project")
      .setDesc(
        "Also look in the project's node_modules/.bin and .venv/bin. This runs a program " +
          "that ships with the folder you opened — leave it off for code you do not trust.",
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.useProjectBinaries).onChange((useProjectBinaries) => {
          service.saveSettings({ useProjectBinaries });
          this.display();
        }),
      );

    const languages = new SettingGroup(this.containerEl).setHeading("Languages");
    for (const group of LANGUAGE_GROUPS) {
      const resolved = service.resolveForGroup(group);
      const choice = settings.servers[group.id] ?? "";
      const first = getLanguageServer(group.servers[0] ?? "");
      const desc =
        choice === "off"
          ? "Off."
          : resolved
            ? `Using ${resolved.server.name} (${resolved.binary}).`
            : `Not installed.${first ? ` Install with: ${first.install}` : ""}`;
      new Setting(languages.itemsEl)
        .setName(group.name)
        .setDesc(desc)
        .addDropdown((dropdown) => {
          dropdown.addOption("", "Automatic");
          for (const id of group.servers) {
            dropdown.addOption(id, getLanguageServer(id)?.name ?? id);
          }
          dropdown.addOption("off", "Off");
          dropdown.setValue(choice).onChange((value) => {
            const servers = { ...service.getSettings().servers };
            if (value) servers[group.id] = value;
            else delete servers[group.id];
            service.saveSettings({ servers });
            this.display();
          });
        });
    }

    const running = service.status();
    const status = new SettingGroup(this.containerEl).setHeading("Running");
    new Setting(status.itemsEl)
      .setName(running.length === 0 ? "No server is running" : `${running.length} running`)
      .setDesc(
        running
          .map((session) => `${session.server} · ${session.root} · ${session.documents} open`)
          .join("\n"),
      )
      .addButton((button) =>
        button.setButtonText("Restart").onClick(() => {
          service.restart();
          this.display();
        }),
      );
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function createLanguageServerPluginDefinition(): InternalPluginDefinition {
  return {
    id: "language-server",
    name: "Language servers",
    description: "Go to definition, find references and hover in code files.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      const service = app.languageServers;
      const activeCode = (): {
        view: CodeFileView;
        file: NonNullable<CodeFileView["file"]>;
      } | null => {
        const view = app.workspace.getActiveViewOfType(CodeFileView);
        return view?.file && view.editorView ? { view, file: view.file } : null;
      };

      plugin.addSettingTab(new LanguageServerSettingTab(app));
      plugin.registerViewType(REFERENCES_VIEW_TYPE, (leaf) => new ReferencesView(leaf));
      // The keys themselves (F12, Shift+F12, Mod+click) are bound in the code
      // editor; these put the same actions in the command palette.
      plugin.registerGlobalCommand({
        id: "language-server:go-to-definition",
        name: "Go to definition",
        icon: "lucide-arrow-up-right",
        checkCallback: (checking: boolean) => {
          const active = activeCode();
          if (!active) return false;
          if (!checking) void service.goToDefinition(active.view.editorView!, active.file);
          return true;
        },
      });
      plugin.registerGlobalCommand({
        id: "language-server:find-references",
        name: "Find references",
        icon: "lucide-list-tree",
        checkCallback: (checking: boolean) => {
          const active = activeCode();
          if (!active) return false;
          if (!checking) void service.showReferences(active.view.editorView!, active.file);
          return true;
        },
      });
      plugin.registerGlobalCommand({
        id: "language-server:restart",
        name: "Restart language servers",
        icon: "lucide-refresh-cw",
        callback: () => service.restart(),
      });
      plugin.register(() => service.shutdown());
    },
  };
}
