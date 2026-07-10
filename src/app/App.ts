import { CommandManager } from "../commands/CommandManager";
import { ViewRegistry } from "../workspace/ViewRegistry";
import { Workspace } from "../workspace/Workspace";
import { PluginManager } from "../plugin/PluginManager";
import { StatusBar } from "./StatusBar";
import { SettingRegistry } from "./SettingRegistry";
import { DataAdapter, InMemoryAdapter } from "../vault/DataAdapter";
import { Vault } from "../vault/Vault";
import { FileManager } from "../vault/FileManager";
import { MetadataCache } from "../metadata/MetadataCache";
import { LinkSuggestionManager } from "../metadata/LinkSuggestionManager";
import { LinkGraph } from "../metadata/LinkGraph";
import { TagIndex } from "../metadata/TagIndex";
import { SearchEngine } from "../search/SearchEngine";
import { MenuManager } from "../menus/MenuManager";
import { ThemeManager } from "../theme/ThemeManager";
import { CustomCss } from "../theme/CustomCss";
import { CssSnippetManager } from "../theme/CssSnippetManager";
import { AppearanceManager, type BaseTheme } from "../theme/AppearanceManager";
import { registerBuiltinViews } from "../builtin/BuiltinViews";
import { registerCorePlugins } from "../builtin/CorePlugins";
import { FilesSettingTab } from "../builtin/FilesSettingTab";
import { AppearanceSettingTab } from "../builtin/AppearanceSettingTab";
import { CorePluginsSettingTab } from "../builtin/CorePluginsSettingTab";
import { CommunityPluginsSettingTab } from "../builtin/CommunityPluginsSettingTab";
import { HotkeysSettingTab } from "../builtin/HotkeysSettingTab";
import { MobileSettingTab } from "../builtin/MobileSettingTab";
import { PluginLoader } from "../plugin/PluginLoader";
import { CorePluginManager } from "../plugin/CorePluginManager";
import { CommunityPluginRegistry } from "../plugin/CommunityPluginRegistry";
import { PluginMarketplace } from "../plugin/PluginMarketplace";
import { PluginSecurityManager } from "../plugin/PluginSecurity";
import { PluginInstaller } from "../plugin/PluginInstaller";
import { UpdateManager } from "../updates/UpdateManager";
import { FileWatcher } from "../vault/FileWatcher";
import { HotkeyManager } from "../hotkeys/HotkeyManager";
import { Keymap } from "../hotkeys/Keymap";
import { WorkspaceServices } from "./WorkspaceServices";
import { registerAppCommands } from "./AppCommands";
import { registerAppProtocolHandlers } from "./AppProtocolHandlers";
import { registerMarkdownDefaultProcessors } from "../markdown/MarkdownDefaultProcessors";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import { RenderContext } from "../markdown/RenderContext";
import { FoldManager } from "../markdown/FoldManager";
import type { TFile, TFolder } from "../vault/TAbstractFile";
import { Notice } from "../ui/Notice";
import { SettingsSectionRegistry } from "../settings/SettingsSection";
import { JsonStore } from "../storage/JsonStore";
import { AppConfigManager } from "../storage/AppConfig";
import { PluginDataStore } from "../storage/PluginDataStore";
import { SecretStorage } from "../storage/SecretStorage";
import { WorkspaceLayoutPersistence } from "../workspace/WorkspaceLayoutPersistence";
import { FileSystemAdapter } from "../vault/FileSystemAdapter";
import { AppLifecycle } from "./AppLifecycle";
import { DiagnosticsManager } from "../diagnostics/DiagnosticsManager";
import { PluginDevTools } from "../devtools/PluginDevTools";
import { DragManager } from "../drag/DragManager";
import { ShellIntegration } from "../shell/ShellIntegration";
import { DesktopMain } from "../desktop/DesktopMain";
import { DesktopMenu } from "../desktop/DesktopMenu";
import { VaultManager } from "../vault/VaultManager";
import { RevisionHistoryService } from "../revisions/RevisionHistory";
import { FileRecoveryService } from "../recovery/FileRecovery";
import { WebViewerService } from "../webviewer/WebViewerService";
import { TerminalService } from "../terminal/TerminalService";
import { ThemeMarketplace } from "../theme-market/ThemeMarketplace";
import { ThemeInstaller } from "../theme-market/ThemeInstaller";
import { ApiDocGenerator } from "../docs/ApiDocGenerator";
import { BuildPipeline } from "../build/BuildPipeline";
import { ReleaseManager } from "../release/ReleaseManager";
import { PluginPackager } from "../packaging/PluginPackager";
import { ThemePackager } from "../packaging/ThemePackager";
import { MetadataTypeManager } from "../properties/MetadataTypeManager";
import { PropertyStore } from "../properties/PropertyStore";
import { QueryEngine } from "../query/QueryEngine";
import { MobileToolbar } from "../mobile/MobileToolbar";
import { MobileBackButtonController } from "../mobile/MobileBackButton";
import { Menu } from "../ui/Menu";
import { Platform } from "../platform/Platform";
import { AppDom } from "./AppDom";
import { writeClipboardText } from "../dom/Clipboard";
import { ProgressBar } from "../ui/ProgressBar";
import { QuitEvent } from "./QuitEvent";
import type { AttachmentImportData, AttachmentImportFile } from "./AttachmentImport";
import { FrameDom } from "./FrameDom";
import { applyObsidianBodyClasses, installFocusBodyClassSync, syncObsidianConfigBodyClasses } from "./BodyClasses";

// The CLI registry and its types live in ../cli/Cli; re-exported here so the
// long-standing `App`-scoped imports (Plugin, InternalPluginWrapper) keep
// working while `App.cli` is the single source of truth.
import { Cli } from "../cli/Cli";
import { registerCliCommands } from "../cli/registerCliCommands";
import type { CliFlags, CliHandler, CliHandlerRegistration } from "../cli/Cli";
export type { CliData, CliFlag, CliFlags, CliHandler, CliHandlerRegistration } from "../cli/Cli";
const localStorageFallback = new Map<string, string>();

function installAnimationFrameFallback(win: Window): void {
  if (!win.requestAnimationFrame) {
    win.requestAnimationFrame = (callback) => win.setTimeout(() => callback(Date.now()), 16);
  }
  if (!win.cancelAnimationFrame) {
    win.cancelAnimationFrame = (handle) => win.clearTimeout(handle);
  }
}


/**
 * One-shot handoff of the vault adapter into the next {@link App} construction.
 *
 * `App.vault` is a field initializer that runs before the constructor body and
 * that many other field initializers depend on, so the adapter cannot be
 * threaded through a constructor parameter (field initializers see neither
 * `this.param` — assigned too late under useDefineForClassFields — nor the bare
 * parameter name). The desktop bootstrap calls {@link provideAppAdapter}
 * synchronously right before `new App(...)`; construction consumes and clears
 * it. With nothing provided (web/tests) the App uses an in-memory adapter.
 */
let nextAppAdapter: DataAdapter | undefined;

export function provideAppAdapter(adapter: DataAdapter | undefined): void {
  nextAppAdapter = adapter;
}

function takeNextAppAdapter(): DataAdapter | undefined {
  const adapter = nextAppAdapter;
  nextAppAdapter = undefined;
  return adapter;
}

export class App {
  readonly appId = "obsidian-reconstructed";
  readonly title = document.title || "Obsidian";
  readonly frameDom: FrameDom;
  readonly dom: AppDom;
  readonly containerEl: HTMLElement;
  lastEvent: Event | null = null;
  readonly cli = new Cli();
  // Read-only view of the registered CLI commands (the registry is a Map on
  // `this.cli`; this preserves the array shape existing callers/tests read).
  get cliHandlers(): CliHandlerRegistration[] {
    return [...this.cli.handlers.values()];
  }
  readonly jsonStore = new JsonStore();
  readonly config = new AppConfigManager(this.jsonStore);
  readonly pluginData = new PluginDataStore(this.jsonStore);
  readonly secretStorage = new SecretStorage();
  readonly diagnostics = new DiagnosticsManager();
  readonly shell = new ShellIntegration();
  readonly desktopMain = new DesktopMain();
  readonly vaults = new VaultManager(this);
  readonly revisions = new RevisionHistoryService(this);
  readonly fileRecovery = new FileRecoveryService(this);
  readonly webViewer = new WebViewerService(this);
  readonly terminals = new TerminalService(this);
  readonly themeMarketplace = new ThemeMarketplace();
  readonly themeInstaller = new ThemeInstaller(this);
  readonly apiDocs = new ApiDocGenerator(this);
  readonly buildPipeline = new BuildPipeline();
  readonly releases = new ReleaseManager();
  readonly pluginPackager = new PluginPackager();
  readonly themePackager = new ThemePackager();
  readonly metadataTypeManager = new MetadataTypeManager(this);
  readonly propertyRegistry = this.metadataTypeManager;
  readonly properties = new PropertyStore(this);
  readonly query = new QueryEngine(this);
  readonly viewRegistry = new ViewRegistry();
  readonly keymap = new Keymap();
  readonly scope = this.keymap.getRootScope();
  readonly hotkeys = new HotkeyManager(this);
  readonly commands = new CommandManager(this.hotkeys, this);
  readonly desktopMenu = new DesktopMenu(this);
  readonly vault = new Vault(takeNextAppAdapter() ?? new InMemoryAdapter(), this.pluginData, this.jsonStore);
  readonly metadataCache = new MetadataCache(this.vault, this);
  readonly linkSuggestions = new LinkSuggestionManager(this);
  readonly linkGraph = new LinkGraph(this);
  readonly tagIndex = new TagIndex(this);
  readonly search = new SearchEngine(this);
  readonly foldManager = new FoldManager();
  readonly menus = new MenuManager(this);
  readonly fileManager = new FileManager(this);
  readonly plugins = new PluginManager(this);
  readonly internalPlugins = new CorePluginManager(this);
  readonly corePluginsReady: Promise<void>;
  readonly communityPlugins = new CommunityPluginRegistry();
  readonly pluginMarketplace = new PluginMarketplace();
  readonly pluginSecurity = new PluginSecurityManager();
  readonly pluginInstaller = new PluginInstaller(this);
  readonly pluginLoader = new PluginLoader(this);
  readonly updates = new UpdateManager(this);
  readonly fileWatcher = new FileWatcher(this.vault);
  readonly devtools = new PluginDevTools(this);
  readonly services: WorkspaceServices;
  readonly dragManager = new DragManager(this);
  readonly uriRouter: WorkspaceServices["uriRouter"];
  readonly windowManager: WorkspaceServices["windowManager"];
  readonly popoutManager: WorkspaceServices["popoutManager"];
  readonly mobileWorkspace: WorkspaceServices["mobileWorkspace"];
  readonly mobileToolbar: MobileToolbar;
  readonly mobileBackButton: MobileBackButtonController;
  readonly hoverPreview: WorkspaceServices["hoverPreview"];
  readonly themes = new ThemeManager(this);
  readonly customCss = new CustomCss(this);
  readonly cssSnippets = new CssSnippetManager(this);
  readonly appearance = new AppearanceManager(this);
  readonly settingSections = new SettingsSectionRegistry();
  readonly workspace: Workspace;
  readonly workspaceLayouts: WorkspaceLayoutPersistence;
  readonly lifecycle = new AppLifecycle(this);
  readonly ready: Promise<void>;
  readonly statusBar: StatusBar;
  readonly setting = new SettingRegistry(this);
  readonly renderContext: RenderContext;

  constructor(parent: HTMLElement = document.body) {
    const doc = parent.ownerDocument;
    const win = doc.defaultView ?? window;
    installAnimationFrameFallback(win);
    applyObsidianBodyClasses(doc.body, win);
    installFocusBodyClassSync(win);
    syncObsidianConfigBodyClasses(doc.body, this);
    this.frameDom = new FrameDom(doc, { hidden: true, win });
    this.dom = new AppDom(parent);
    this.containerEl = this.dom.appContainerEl;
    this.renderContext = new RenderContext(this, "", this.containerEl);
    this.pluginSecurity.setAppId(this.appId);
    this.jsonStore.on<[string]>("raw", (path) => this.vault.trigger("raw", path));
    this.vault.setConfigDir(window.localStorage?.getItem(`${this.appId}-config`) ?? "");
    this.vault.on<[string]>("raw", (path) => {
      if (this.isConfigReloadPath(path)) this.vault.requestReloadConfig();
      if (this.customCss.isCssConfigPath(path)) this.customCss.onRaw(path);
    });
    this.vault.on<[string]>("config-changed", (key) => {
      const configKey = String(key);
      this.onConfigChanged(configKey);
      this.onBodyClassConfigChanged(configKey);
      if (configKey === "nativeMenus") this.desktopMenu.refresh();
    });

    this.registerBuiltInViews();
    this.workspace = new Workspace(this, this.dom.workspaceEl);
    this.services = new WorkspaceServices(this);
    this.uriRouter = this.services.uriRouter;
    this.windowManager = this.services.windowManager;
    this.popoutManager = this.services.popoutManager;
    this.mobileWorkspace = this.services.mobileWorkspace;
    this.mobileBackButton = new MobileBackButtonController(this);
    this.mobileToolbar = new MobileToolbar(this);
    if (Platform.isMobile) this.mobileToolbar.attachListeners();
    this.hoverPreview = this.services.hoverPreview;
    this.workspaceLayouts = new WorkspaceLayoutPersistence(this);
    this.statusBar = new StatusBar(this.dom.statusBarEl);
    this.appearance.applyFromConfig();
    registerAppCommands(this);
    this.cli.init(this);
    registerCliCommands(this);
    this.desktopMenu.refresh();
    MarkdownRenderer.resetProcessors();
    registerMarkdownDefaultProcessors(this);
    this.registerSettings();
    this.registerGlobalHotkeys();
    this.corePluginsReady = registerCorePlugins(this);
    registerAppProtocolHandlers(this);
    this.registerQuitHook();
    this.updateUseNativeMenu();
    this.updateInlineTitleDisplay();
    this.updateFloatingNavigationDisplay();
    this.updateAutoFullScreenDisplay();
    this.ready = Promise.resolve().then(() => this.lifecycle.load());
  }

  getAppTitle(title = ""): string {
    return title ? `${title} - ${this.title}` : this.title;
  }

  getObsidianUrl(file: TFile): string {
    const path = file.extension === "md" ? file.path.slice(0, -3) : file.path;
    return `obsidian://open?vault=${encodeURIComponent(this.vault.getName())}&file=${encodeURIComponent(path)}`;
  }

  async copyObsidianUrl(file: TFile): Promise<void> {
    await writeClipboardText(this.getObsidianUrl(file));
    new Notice("Copied URL");
  }

  async openWithDefaultApp(path: string): Promise<void> {
    const adapter = this.vault.adapter;
    if (Platform.isDesktopApp && adapter instanceof FileSystemAdapter) {
      window.open(adapter.getFilePath(path), "_external");
      return;
    }
    if (Platform.isMobileApp && hasMobileOpenAdapter(adapter)) {
      try {
        await adapter.open(path);
      } catch (error) {
        new Notice(error instanceof Error && error.message ? error.message : `Failed to load file: ${path}`);
      }
    }
  }

  showInFolder(path: string): void {
    if (!Platform.isDesktopApp) return;
    const adapter = this.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const fullPath = adapter.getFullPath(path);
    void (async () => {
      if (!await adapter.exists(path)) {
        new Notice(`File not found: ${fullPath}`);
        return;
      }
      showItemInFolder(fullPath, this.containerEl.ownerDocument.defaultView ?? window);
    })();
  }

  isDarkMode(): boolean {
    return this.appearance.isDarkMode();
  }

  getTheme(): "obsidian" | "moonstone" {
    return this.isDarkMode() ? "obsidian" : "moonstone";
  }

  changeTheme(theme: BaseTheme): void {
    if (!theme) return;
    this.disableCssTransition();
    this.vault.setConfig("theme", theme);
    this.updateTheme();
    const win = this.containerEl.ownerDocument.defaultView ?? window;
    win.setTimeout(() => this.enableCssTransition(), 200);
  }

  updateTheme(): void {
    this.appearance.applyBaseTheme(this.vault.getConfig<BaseTheme>("theme") ?? "system");
  }

  disableCssTransition(): void {
    this.containerEl.classList.add("no-transition");
  }

  enableCssTransition(): void {
    this.containerEl.classList.remove("no-transition");
  }

  updateUseNativeMenu(): void {
    let useNativeMenu = this.vault.getConfig<boolean | null>("nativeMenus");
    if (Platform.isMacOS && useNativeMenu == null) useNativeMenu = true;
    Menu.useNativeMenu = useNativeMenu === true;
  }

  updateAccentColor(): void {
    this.setAccentColor(this.vault.getConfig<string>("accentColor") ?? "");
  }

  getAccentColor(): string {
    return this.appearance.getAccentColor();
  }

  setAccentColor(color: string | null | undefined): void {
    this.appearance.applyAccentColor(color ?? "");
  }

  updateFontFamily(): void {
    this.appearance.updateFontFamily();
  }

  updateFontSize(): void {
    this.appearance.updateFontSize();
  }

  updateTabSize(): void {
    this.appearance.updateTabSize();
  }

  updateInlineTitleDisplay(): void {
    this.dom.appContainerEl.ownerDocument.body.classList.toggle("show-inline-title", Boolean(this.vault.getConfig("showInlineTitle")));
  }

  updateFloatingNavigationDisplay(): void {
    this.dom.appContainerEl.ownerDocument.body.classList.toggle("is-floating-nav", Boolean(this.vault.getConfig("floatingNavigation")));
  }

  updateAutoFullScreenDisplay(): void {
    this.dom.appContainerEl.ownerDocument.body.classList.toggle("auto-full-screen", Boolean(this.vault.getConfig("autoFullScreen")));
  }

  updateViewHeaderDisplay(): void {
    syncObsidianConfigBodyClasses(this.dom.appContainerEl.ownerDocument.body, this);
  }

  updateRibbonDisplay(): void {
    syncObsidianConfigBodyClasses(this.dom.appContainerEl.ownerDocument.body, this);
  }

  private onBodyClassConfigChanged(key: string): void {
    if (key === "showViewHeader") this.updateViewHeaderDisplay();
    if (key === "showRibbon") this.updateRibbonDisplay();
  }

  fixFileLinks(el: HTMLElement, sourcePath = ""): void {
    for (const media of el.querySelectorAll<HTMLImageElement | HTMLAudioElement | HTMLVideoElement | HTMLSourceElement | HTMLIFrameElement>("img, audio, video, source, iframe")) {
      const src = media.getAttribute("src");
      if (!src) continue;
      const file = this.resolveMediaSrc(src, sourcePath);
      if (!file) continue;
      const resourcePath = this.vault.getResourcePath(file);
      if (resourcePath) media.setAttribute("src", resourcePath);
    }
  }

  // The CLI registry lives on `this.cli`; these delegate so the established
  // `app.registerCliHandler(...)` call sites (Plugin, InternalPluginWrapper)
  // keep working against the single faithful registry.
  registerCliHandler(command: string, description: string, flags: CliFlags | null, handler: CliHandler, owner?: string): CliHandlerRegistration {
    return this.cli.registerHandler(command, description, flags, handler, owner);
  }

  unregisterCliHandler(registration: CliHandlerRegistration): void;
  unregisterCliHandler(id: string, handler?: CliHandler): void;
  unregisterCliHandler(idOrRegistration: string | CliHandlerRegistration, handler?: CliHandler): void {
    this.cli.unregisterHandler(idOrRegistration, handler);
  }

  resolveAttachmentFile(file: AttachmentImportFile): TFile | null {
    return this.fileManager.resolveAttachmentFile(file);
  }

  async importAttachments(files: AttachmentImportFile[], targetFolder: TFolder | null = null, sourceFile: TFile | null = this.workspace.getActiveFile()): Promise<TFile[]> {
    return this.fileManager.importAttachments(files, targetFolder, sourceFile);
  }

  async saveAttachment(name: string, extension: string, data: AttachmentImportData, sourceFile: TFile | null = this.workspace.getActiveFile()): Promise<TFile> {
    return this.fileManager.saveAttachment(name, extension, data, sourceFile);
  }

  async showReleaseNotes(version = "current"): Promise<void> {
    await this.workspace.getLeaf(true).setViewState({
      type: "release-notes",
      active: true,
      state: { currentVersion: version },
    });
  }

  loadLocalStorage<T = unknown>(key: string): T | null {
    const storageKey = this.getLocalStorageKey(key);
    const value = getBrowserStorage()?.getItem(storageKey) ?? localStorageFallback.get(storageKey) ?? null;
    if (value == null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  saveLocalStorage<T = unknown>(key: string, value: T | null | undefined): void {
    const storageKey = this.getLocalStorageKey(key);
    if (!value) {
      localStorageFallback.delete(storageKey);
      getBrowserStorage()?.removeItem(storageKey);
      return;
    }
    const serialized = JSON.stringify(value);
    localStorageFallback.set(storageKey, serialized);
    getBrowserStorage()?.setItem(storageKey, serialized);
  }

  private getLocalStorageKey(key: string): string {
    return `${this.appId}-${key}`;
  }

  private resolveMediaSrc(src: string, sourcePath: string): TFile | null {
    const fileUrl = this.vault.resolveFileUrl(src);
    if (fileUrl) return fileUrl;
    if (isExternalMediaSrc(src)) return null;
    const linktext = decodeMediaLinkpath(stripQueryAndHash(src));
    if (!linktext) return null;
    return this.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
  }

  private registerBuiltInViews(): void {
    registerBuiltinViews(this);
  }

  private registerSettings(): void {
    this.settingSections.register({ id: "editor", name: "Editor", order: 10 });
    this.settingSections.register({ id: "file", name: "Files and links", order: 15 });
    this.settingSections.register({ id: "appearance", name: "Appearance", order: 20 });
    this.settingSections.register({ id: "core-plugins", name: "Core plugins", order: 30 });
    this.settingSections.register({ id: "community-plugins", name: "Community plugins", order: 40 });
    this.setting.addSettingTab(new FilesSettingTab(this));
    this.setting.addSettingTab(new AppearanceSettingTab(this));
    this.setting.addSettingTab(new MobileSettingTab(this));
    this.setting.addSettingTab(new HotkeysSettingTab(this));
    this.setting.addSettingTab(new CorePluginsSettingTab(this));
    this.setting.addSettingTab(new CommunityPluginsSettingTab(this));
  }

  private registerGlobalHotkeys(): void {
    this.hotkeys.registerListeners();
  }

  private registerQuitHook(): void {
    window.onbeforeunload = (event: BeforeUnloadEvent) => {
      window.onbeforeunload = null;
      void this.workspace.requestSaveLayout.run();
      const quitEvent = new QuitEvent();
      this.workspace.trigger("quit", quitEvent);
      if (quitEvent.isEmpty()) return undefined;
      event.preventDefault();
      event.returnValue = "Saving...";
      ProgressBar.instance.show().setMessage("Saving...");
      void quitEvent.promise().then(() => window.close());
      return "Saving...";
    };
  }

  private isConfigReloadPath(path: string): boolean {
    const configDir = this.vault.configDir;
    return path === `${configDir}/app.json`
      || path === `${configDir}/appearance.json`
      || path === this.jsonStore.path("app.json")
      || path === this.jsonStore.path("appearance.json");
  }

  private onConfigChanged(key: string): void {
    if (key === "cssTheme") this.customCss.requestLoadTheme();
    if (key === "enabledCssSnippets") this.customCss.requestLoadSnippets();
    if (key === "theme") this.updateTheme();
    if (key === "accentColor") this.updateAccentColor();
    if (fontFamilyKeys.has(key)) this.updateFontFamily();
    if (key === "baseFontSize") this.updateFontSize();
    if (key === "tabSize") this.updateTabSize();
    if (key === "showInlineTitle") this.updateInlineTitleDisplay();
    if (key === "floatingNavigation") this.updateFloatingNavigationDisplay();
    if (key === "autoFullScreen") this.updateAutoFullScreenDisplay();
    if (key === "nativeMenus") this.updateUseNativeMenu();
  }
}

const fontFamilyKeys = new Set([
  "textFontFamily",
  "interfaceFontFamily",
  "monospaceFontFamily",
]);

function isExternalMediaSrc(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src);
}

function getBrowserStorage(): Storage | null {
  try {
    return globalThis.window?.localStorage ?? null;
  } catch {
    return null;
  }
}

function hasMobileOpenAdapter(adapter: unknown): adapter is { open(path: string): Promise<void> | void } {
  return typeof (adapter as { open?: unknown } | null)?.open === "function";
}

function showItemInFolder(path: string, win: Window): boolean {
  const shell = getElectronShell(win);
  if (!shell?.showItemInFolder) return false;
  shell.showItemInFolder(path);
  return true;
}

function getElectronShell(win: Window): { showItemInFolder?: (path: string) => void } | null {
  const host = globalThis as {
    electron?: { shell?: { showItemInFolder?: (path: string) => void } };
    require?: (moduleName: "electron") => { shell?: { showItemInFolder?: (path: string) => void } };
  };
  const electron = (win as Window & { electron?: { shell?: { showItemInFolder?: (path: string) => void } } }).electron
    ?? host.electron
    ?? safeRequireElectron(host);
  return electron?.shell ?? null;
}

function safeRequireElectron(host: { require?: (moduleName: "electron") => { shell?: { showItemInFolder?: (path: string) => void } } }): { shell?: { showItemInFolder?: (path: string) => void } } | null {
  try {
    return host.require?.("electron") ?? null;
  } catch {
    return null;
  }
}

function stripQueryAndHash(src: string): string {
  const queryIndex = src.indexOf("?");
  const hashIndex = src.indexOf("#");
  const indexes = [queryIndex, hashIndex].filter((index) => index !== -1);
  return indexes.length > 0 ? src.slice(0, Math.min(...indexes)) : src;
}

function decodeMediaLinkpath(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}
