/**
 * Input: ./App, ../builtin/DailyNotes, ./MetadataIndexingNotice, ../ui/ProgressBar, ../vault/TAbstractFile
 * Output: AppLifecycle
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "./App";
import type { DailyNotesController } from "../builtin/DailyNotes";
import { installSlowIndexingNotice, showIndexingNotice } from "./MetadataIndexingNotice";
import { ProgressBar } from "../ui/ProgressBar";
import { TFile } from "../vault/TAbstractFile";

export class AppLifecycle {
  private started = false;

  constructor(readonly app: App) {}

  async load(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // The startup splash covers the whole awaited sequence, advancing through
    // the real app's stage messages (loadingPlugins → loadingVault →
    // loadingCache → loadingWorkspace). On failure it stays up with the
    // failure message instead of hiding, as the real splash does.
    const splash = ProgressBar.instance.setMessage("Loading plugins...").show();
    try {
      await this.app.vault.setupConfig();
      this.app.themes.loadDefaultTheme();
      await this.app.customCss.load();
      this.app.themes.applyConfiguredTheme();
      this.app.appearance.applyFromConfig();
      this.app.cssSnippets.applyEnabledSnippetsFromConfig();
      await this.app.metadataTypeManager.load();
      await this.app.corePluginsReady;
      await this.app.hotkeys.load();
      await this.app.pluginInstaller.initialize();
      splash.setMessage("Loading vault...");
      // Startup-phase marks: the three awaits that gate first paint on a large
      // vault. Read with performance.measure / the profiler; they cost nothing.
      performance.mark("app:vault-load:start");
      await this.app.vault.load();
      performance.mark("app:vault-load:end");
      this.app.hotkeys.registerListeners();
      this.app.mobileBackButton.attach();
      this.app.metadataTypeManager.registerListeners();
      installSlowIndexingNotice(this.app.metadataCache);
      splash.setMessage("Loading cache...");
      performance.mark("app:metadata-init:start");
      await this.app.metadataCache.initialize();
      performance.mark("app:metadata-init:end");
      showIndexingNotice(this.app.metadataCache);
      splash.setMessage("Loading workspace...");
      performance.mark("app:layout:start");
      await this.app.workspace.loadLayout();
      performance.mark("app:layout:end");
      await this.runOpeningBehavior();
      if (!this.app.workspace.isLayoutReady()) this.app.workspace.markLayoutReady();
      await this.app.workspace.waitForLayoutReadyCallbacks();
      this.app.workspace.registerUriHook();
    } catch (error) {
      splash.setMessage(
        `Failed to load vault: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    splash.hide();
    this.app.workspace.trigger("app-loaded");
  }

  async save(): Promise<void> {
    await this.app.workspace.requestSaveLayout.run();
    await this.app.hotkeys.save();
    await this.app.vault.requestSaveConfig.run();
    this.app.workspace.trigger("app-saved");
  }

  async unload(): Promise<void> {
    await this.save();
    this.app.mobileBackButton.detach();
    this.app.hotkeys.unregisterListeners();
    this.app.metadataTypeManager.unregisterListeners();
    this.app.vault.unload();
    this.started = false;
    this.app.workspace.trigger("app-unloaded");
  }

  private async runOpeningBehavior(): Promise<void> {
    const behavior = this.app.vault.getConfig<string>("openBehavior") ?? "";
    const pendingUrlAction = (window as { OBS_ACT?: unknown }).OBS_ACT;
    if (pendingUrlAction && typeof pendingUrlAction !== "function") return;
    if (!behavior) return;
    if (behavior === "new") {
      await this.app.fileManager.createAndOpenMarkdownFile("");
      return;
    }
    if (behavior === "daily") {
      const dailyNotes =
        this.app.internalPlugins.getEnabledPluginById<DailyNotesController>("daily-notes");
      const file = await dailyNotes?.getDailyNote();
      if (file)
        await this.app.workspace
          .getLeaf()
          .openFile(file, { active: true, state: { mode: "source" } });
      return;
    }
    if (behavior.startsWith("file:")) {
      let path = behavior.slice(5).replace(/^\/+/, "");
      if (!getExtension(path)) path += ".md";
      const file = this.app.vault.getAbstractFileByPathInsensitive(path);
      if (file instanceof TFile) await this.app.workspace.openFile(file, { active: true });
    }
  }
}

function getExtension(path: string): string {
  const filename = path.split("/").pop() ?? "";
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index + 1);
}
