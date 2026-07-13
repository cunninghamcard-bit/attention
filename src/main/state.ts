/**
 * Shared mutable state for the Electron main process.
 *
 * Mirrors the module-scoped flags in the real Obsidian `obsidian.asar/main.js`
 * (`ye` = isQuitting, `Be` = the `app://<random>/` file origin prefix). Later
 * layers (L4 protocol, L2 vault registry) attach their own state here so every
 * part of the main process reads a single source of truth.
 */
export interface MainState {
  /** Set on `before-quit`; read back by the renderer via `is-quitting`. Real: `ye`. */
  isQuitting: boolean;
  /**
   * Prefix the renderer prepends to vault file paths to build loadable URLs,
   * returned by the `file-url` IPC. Real Obsidian returns `app://<random>/`
   * (symbol `Be`); until the `app://` protocol lands in L4 this is `file://`,
   * which is a correct prefix for a file-backed vault.
   */
  fileUrlPrefix: string;
}

export const mainState: MainState = {
  isQuitting: false,
  fileUrlPrefix: "file://",
};
