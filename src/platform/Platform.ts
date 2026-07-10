export interface PlatformApi {
  isDesktop: boolean;
  isMobile: boolean;
  isDesktopApp: boolean;
  isMobileApp: boolean;
  isIosApp: boolean;
  isAndroidApp: boolean;
  isPhone: boolean;
  isTablet: boolean;
  isMacOS: boolean;
  isWin: boolean;
  isLinux: boolean;
  isSafari: boolean;
  hasPhysicalKeyboard: boolean;
  resourcePathPrefix: string;
  readonly canExportPdf: boolean;
  readonly canPopoutWindow: boolean;
  readonly canStackTabs: boolean;
  readonly canSplit: boolean;
  readonly canDisplayRibbon: boolean;
  readonly canPinSidebar: boolean;
  supportsIndexedDb: boolean;
  mobileSoftKeyboardVisible: boolean;
  version: string;
  build: string;
  manufacturer: string;
  model: string;
  osName: string;
  osVersion: string;
  deviceName: string;
}

const navigatorRef = typeof navigator !== "undefined" ? navigator : null;
const appVersion = navigatorRef?.appVersion ?? "";
const userAgent = navigatorRef?.userAgent ?? "";
const platform = navigatorRef?.platform ?? "";
const vendor = navigatorRef?.vendor ?? "";
const maxTouchPoints = navigatorRef?.maxTouchPoints ?? 0;
const isIosLike = /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
const isAndroidLike = /Android/.test(userAgent);
const osName = appVersion.includes("Win") ? "Windows" : appVersion.includes("Mac") ? "macOS" : appVersion.includes("X11") || appVersion.includes("Linux") ? "Linux" : "Unknown OS";

export const Platform: PlatformApi = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: osName === "macOS",
  isWin: osName === "Windows",
  isLinux: osName === "Linux",
  isSafari: /Safari/.test(userAgent) && /Apple/.test(vendor) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent),
  hasPhysicalKeyboard: !isAndroidLike && !isIosLike,
  resourcePathPrefix: resolveResourcePathPrefix(),
  get canExportPdf() {
    return Platform.isDesktopApp;
  },
  get canPopoutWindow() {
    return Platform.isDesktopApp && Platform.isDesktop;
  },
  get canStackTabs() {
    return !Platform.isPhone;
  },
  get canSplit() {
    return !Platform.isPhone;
  },
  get canDisplayRibbon() {
    return !Platform.isPhone;
  },
  get canPinSidebar() {
    return Platform.isMobile && !Platform.isPhone;
  },
  supportsIndexedDb: typeof window !== "undefined" && Boolean(window.indexedDB),
  mobileSoftKeyboardVisible: false,
  // Real Yl.version/Yl.build (app vs installer). This reconstruction has no
  // asar/installer split, so both carry the one real app version.
  version: resolveAppVersion(),
  build: resolveAppVersion(),
  manufacturer: "",
  model: "",
  osName: "",
  osVersion: "",
  deviceName: "",
};

function resolveResourcePathPrefix(): string {
  const maybeGlobal = globalThis as {
    electron?: ElectronBridge;
    window?: {
      electron?: ElectronBridge;
    };
    require?: (moduleName: "electron") => {
      ipcRenderer?: ElectronBridge["ipcRenderer"];
    };
  };

  try {
    const bridge = maybeGlobal.window?.electron ?? maybeGlobal.electron ?? maybeGlobal.require?.("electron");
    const prefix = bridge?.ipcRenderer?.sendSync?.("file-url");
    if (typeof prefix === "string" && prefix.length > 0) return prefix;
  } catch {
    // Electron is not available in browser/test environments.
  }

  return "file:///";
}

interface ElectronBridge {
  ipcRenderer?: {
    sendSync?: (channel: string) => unknown;
  };
}

// The main process's `version` sync channel (app.getVersion()). Empty outside
// the desktop shell (browser/test environments).
function resolveAppVersion(): string {
  const maybeGlobal = globalThis as { electron?: ElectronBridge; window?: { electron?: ElectronBridge } };
  try {
    const version = (maybeGlobal.window?.electron ?? maybeGlobal.electron)?.ipcRenderer?.sendSync?.("version");
    if (typeof version === "string") return version;
  } catch {
    // Electron is not available in browser/test environments.
  }
  return "";
}
