/**
 * Input: @codemirror/lsp-client, @codemirror/state, @codemirror/view, @app/shared/lspApi, ../../app/App, ../../app/hotkeys/Keymap, ../../core/ApiUtils, ../../mount/MountAdapter, ../../ui/Notice, ../../vault/TAbstractFile, ../../views/CodeFileView, ./LanguageServerRegistry, ./LanguageSession, ./LanguageUri, ./ReferencesView
 * Output: LanguageServerSettings, LanguageLocation, LanguageServerStatus, LanguageAvailability, LanguageServerService
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { LSPPlugin } from "@codemirror/lsp-client";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { ElectronLspApi } from "@app/shared/lspApi";
import type { App } from "../../app/App";
import { Keymap } from "../../app/hotkeys/Keymap";
import { sanitizeHTMLToDom } from "../../core/ApiUtils";
import { MountAdapter } from "../../mount/MountAdapter";
import { Notice } from "../../ui/Notice";
import { TFile } from "../../vault/TAbstractFile";
import { CodeFileView } from "../../views/CodeFileView";
import type { LeafOpenMode } from "../../views/workspace/Workspace";
import {
  getLanguageServer,
  languageForExtension,
  type LanguageGroup,
  type LanguageServerSpec,
} from "./LanguageServerRegistry";
import { LanguageSession, type LanguageRoot } from "./LanguageSession";
import { REFERENCES_VIEW_TYPE, ReferencesView } from "./ReferencesView";
import { normalizeLocations, pathToUri, uriToPath, type LanguageRange } from "./LanguageUri";

const SETTINGS_KEY = "language-server-settings";

/** A server that fails this many times inside the window is left stopped. */
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 60_000;
/** Servers close this long after their last document does. */
const IDLE_MS = 5 * 60_000;

export interface LanguageServerSettings {
  enabled: boolean;
  /**
   * Also look for servers inside the project (`node_modules/.bin`, `.venv/bin`).
   * Off by default: it runs a program that ships with the folder being read.
   */
  useProjectBinaries: boolean;
  /** Language group id → server id, or "off". Absent means automatic. */
  servers: Record<string, string>;
  /** Server id → an explicit executable path. */
  binaries: Record<string, string>;
}

const DEFAULT_SETTINGS: LanguageServerSettings = {
  enabled: true,
  useProjectBinaries: false,
  servers: {},
  binaries: {},
};

/** A place in a document, in both the server's terms and the vault's. */
export interface LanguageLocation extends LanguageRange {
  /** Vault path, or null when the document is outside every mounted root. */
  path: string | null;
  /** Absolute path on disk. */
  fullPath: string;
  /** The line's text, when the document could be read. */
  text: string | null;
}

export interface LanguageServerStatus {
  server: string;
  language: string;
  root: string;
  binary: string;
  pid: number;
  state: LanguageSession["state"];
  documents: number;
}

/** Why a file has, or does not have, a language server behind it. */
export type LanguageAvailability =
  | { kind: "ready"; server: LanguageServerSpec; binary: string }
  | { kind: "unsupported" }
  | { kind: "no-bridge" }
  | { kind: "disabled" }
  | { kind: "no-root" }
  | { kind: "not-installed"; group: LanguageGroup; candidates: LanguageServerSpec[] }
  | { kind: "failed"; group: LanguageGroup; detail: string };

/** Hover markup from the server, cleaned the way the app cleans any HTML. */
function sanitizeHTML(html: string): string {
  const el = document.createElement("div");
  el.append(sanitizeHTMLToDom(html));
  return el.innerHTML;
}

export class LanguageServerService {
  private readonly sessions = new Map<string, Promise<LanguageSession | null>>();
  private readonly live = new Set<LanguageSession>();
  /** Client → its session. The client itself cannot say whether its server died. */
  private readonly byClient = new WeakMap<object, LanguageSession>();
  /** `${sessionKey}\0${serverId}` → why that server will not be tried again. */
  private readonly failures = new Map<string, string>();
  private readonly crashes = new Map<string, number[]>();
  private readonly announced = new Set<string>();

  constructor(readonly app: App) {}

  // ---- settings ---------------------------------------------------------

  getSettings(): LanguageServerSettings {
    const saved = this.app.loadLocalStorage<Partial<LanguageServerSettings>>(SETTINGS_KEY) ?? {};
    return {
      enabled: saved.enabled !== false,
      useProjectBinaries: saved.useProjectBinaries === true,
      servers: { ...DEFAULT_SETTINGS.servers, ...saved.servers },
      binaries: { ...DEFAULT_SETTINGS.binaries, ...saved.binaries },
    };
  }

  /** Save and restart: every setting here changes which process should run. */
  saveSettings(settings: Partial<LanguageServerSettings>): void {
    this.app.saveLocalStorage(SETTINGS_KEY, { ...this.getSettings(), ...settings });
    this.restart();
  }

  // ---- roots and paths ---------------------------------------------------

  get bridge(): ElectronLspApi | null {
    const bridge = (globalThis as { electronLsp?: ElectronLspApi }).electronLsp;
    return bridge?.available ? bridge : null;
  }

  /** Every mounted folder that lives on disk. */
  roots(): LanguageRoot[] {
    const adapter = this.app.vault.adapter;
    const roots: LanguageRoot[] = [];
    const add = (name: string, base: string | undefined): void => {
      if (!base) return;
      const path = base.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
      roots.push({ name, path, uri: pathToUri(path) });
    };
    if (adapter instanceof MountAdapter) {
      for (const mount of adapter.getMounts()) {
        add(mount.name, (mount.adapter as { getBasePath?(): string }).getBasePath?.());
      }
    } else {
      add("", (adapter as { getBasePath?(): string }).getBasePath?.());
    }
    return roots;
  }

  /** The root a vault path belongs to, with the document's disk identity. */
  locate(path: string): { root: LanguageRoot; fullPath: string; uri: string } | null {
    for (const root of this.roots()) {
      let inner: string;
      if (root.name === "") inner = path;
      else if (path.startsWith(`${root.name}/`)) inner = path.slice(root.name.length + 1);
      else continue;
      const fullPath = `${root.path}/${inner}`;
      return { root, fullPath, uri: pathToUri(fullPath) };
    }
    return null;
  }

  /** The vault path for a document URI; null outside every mounted root. */
  pathForUri(uri: string): string | null {
    const fullPath = uriToPath(uri)?.replace(/\\/g, "/");
    if (!fullPath) return null;
    for (const root of this.roots()) {
      if (!fullPath.startsWith(`${root.path}/`)) continue;
      const inner = fullPath.slice(root.path.length + 1);
      return root.name ? `${root.name}/${inner}` : inner;
    }
    return null;
  }

  // ---- sessions ----------------------------------------------------------

  private sessionKey(group: LanguageGroup, root: LanguageRoot): string {
    return `${root.path}\0${group.id}`;
  }

  /** Servers to try for a language, in order, honoring the user's choice. */
  private candidates(group: LanguageGroup): LanguageServerSpec[] {
    const choice = this.getSettings().servers[group.id];
    if (choice === "off") return [];
    const ids = choice && group.servers.includes(choice) ? [choice] : group.servers;
    return ids.map(getLanguageServer).filter((spec): spec is LanguageServerSpec => spec !== null);
  }

  private resolveBinary(spec: LanguageServerSpec, root: LanguageRoot | null): string | null {
    const bridge = this.bridge;
    if (!bridge) return null;
    const settings = this.getSettings();
    const explicit = settings.binaries[spec.id]?.trim();
    if (explicit) return bridge.resolve(explicit);
    const projectDirs =
      root && settings.useProjectBinaries
        ? [`${root.path}/node_modules/.bin`, `${root.path}/.venv/bin`]
        : [];
    return bridge.resolve(spec.command, projectDirs);
  }

  /** The server a language would use right now, ignoring per-project installs. */
  resolveForGroup(group: LanguageGroup): { server: LanguageServerSpec; binary: string } | null {
    for (const server of this.candidates(group)) {
      const binary = this.resolveBinary(server, null);
      if (binary) return { server, binary };
    }
    return null;
  }

  /** What would serve this file, without starting anything. */
  availability(file: TFile): LanguageAvailability {
    const language = languageForExtension(file.extension);
    if (!language) return { kind: "unsupported" };
    if (!this.bridge) return { kind: "no-bridge" };
    if (!this.getSettings().enabled) return { kind: "disabled" };
    const located = this.locate(file.path);
    if (!located) return { kind: "no-root" };
    const candidates = this.candidates(language.group);
    if (candidates.length === 0) return { kind: "disabled" };
    const key = this.sessionKey(language.group, located.root);
    let failure = "";
    for (const spec of candidates) {
      const failed = this.failures.get(`${key}\0${spec.id}`);
      if (failed) {
        failure = `${spec.name}: ${failed}`;
        continue;
      }
      const binary = this.resolveBinary(spec, located.root);
      if (binary) return { kind: "ready", server: spec, binary };
    }
    if (failure) return { kind: "failed", group: language.group, detail: failure };
    return { kind: "not-installed", group: language.group, candidates };
  }

  /** The running server for a file, starting it on first use. */
  sessionFor(file: TFile): Promise<LanguageSession | null> {
    const language = languageForExtension(file.extension);
    const located = language ? this.locate(file.path) : null;
    if (!language || !located || !this.bridge || !this.getSettings().enabled) {
      return Promise.resolve(null);
    }
    const key = this.sessionKey(language.group, located.root);
    let pending = this.sessions.get(key);
    if (!pending) {
      pending = this.start(key, language.group, located.root);
      this.sessions.set(key, pending);
      // A failed start is not cached: installing the server later must work
      // without a restart. Individual bad servers are remembered in `failures`.
      void pending.then((session) => {
        if (!session && this.sessions.get(key) === pending) this.sessions.delete(key);
      });
    }
    return pending;
  }

  private async start(
    key: string,
    group: LanguageGroup,
    root: LanguageRoot,
  ): Promise<LanguageSession | null> {
    const bridge = this.bridge;
    if (!bridge) return null;
    for (const spec of this.candidates(group)) {
      const failureKey = `${key}\0${spec.id}`;
      if (this.failures.has(failureKey)) continue;
      const binary = this.resolveBinary(spec, root);
      if (!binary) continue;
      let session: LanguageSession;
      try {
        const handle = bridge.spawn({ command: binary, args: spec.args, cwd: root.path });
        session = new LanguageSession({
          spec,
          group,
          root,
          binary,
          handle,
          sanitizeHTML,
          idleMs: IDLE_MS,
          host: {
            loadDocument: (uri) => this.loadDocument(uri),
            displayDocument: (uri) => this.displayDocument(uri),
          },
          onExit: (exited) => this.onUnexpectedExit(key, exited),
          onIdle: (idle) => this.stop(key, idle),
        });
      } catch (error) {
        this.failures.set(failureKey, error instanceof Error ? error.message : String(error));
        continue;
      }
      this.live.add(session);
      this.byClient.set(session.client, session);
      if (await session.ready) return session;
      // It never initialized — wrong version, missing runtime, bad flag. Note
      // why and fall through to the next server for this language.
      this.live.delete(session);
      session.dispose();
      this.failures.set(
        failureKey,
        session.stderrTail.trim().split("\n").pop() || "exited during startup",
      );
    }
    return null;
  }

  private stop(key: string, session: LanguageSession): void {
    this.live.delete(session);
    this.sessions.delete(key);
    session.dispose();
  }

  private onUnexpectedExit(key: string, session: LanguageSession): void {
    // A server that dies before it is ready is `start`'s to report: it notes
    // the failure and moves on to the next candidate.
    if (!session.everReady || !this.live.delete(session)) return;
    this.sessions.delete(key);
    const now = Date.now();
    const recent = (this.crashes.get(key) ?? []).filter((at) => now - at < CRASH_WINDOW_MS);
    recent.push(now);
    this.crashes.set(key, recent);
    if (recent.length >= MAX_CRASHES) {
      this.failures.set(`${key}\0${session.spec.id}`, "stopped repeatedly");
      new Notice(
        `${session.spec.name} keeps stopping and was turned off for ${session.root.name || "this folder"}.`,
      );
    }
    // Open code views re-ask for their extension; that restarts the server
    // (or the next candidate) while the crash budget lasts.
    this.app.workspace.trigger("language-server-change");
  }

  /** Stop every server and forget past failures; open views reconnect. */
  restart(): void {
    for (const session of this.live) session.dispose();
    this.live.clear();
    this.sessions.clear();
    this.failures.clear();
    this.crashes.clear();
    this.announced.clear();
    this.app.workspace.trigger("language-server-change");
  }

  /** Stop every server without reconnecting (app shutdown, plugin disable). */
  shutdown(): void {
    for (const session of this.live) session.dispose();
    this.live.clear();
    this.sessions.clear();
  }

  status(): LanguageServerStatus[] {
    return [...this.live].map((session) => ({
      server: session.spec.id,
      language: session.group.id,
      root: session.root.name || session.root.path,
      binary: session.binary,
      pid: session.pid,
      state: session.state,
      documents: session.openCount,
    }));
  }

  // ---- the workspace host ------------------------------------------------

  private async loadDocument(uri: string): Promise<{ languageId: string; text: string } | null> {
    const path = this.pathForUri(uri);
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile)) return null;
    const language = languageForExtension(file.extension);
    return {
      languageId: language?.languageId ?? "plaintext",
      text: await this.app.vault.cachedRead(file),
    };
  }

  private async displayDocument(uri: string): Promise<EditorView | null> {
    const view = await this.openUri(uri, false);
    return view?.editorView ?? null;
  }

  /** Open the document a URI names; null (with a notice) when it is not in the workspace. */
  private async openUri(
    uri: string,
    mode: LeafOpenMode,
    reveal?: { line: number; start: number; end: number },
  ): Promise<CodeFileView | null> {
    const path = this.pathForUri(uri);
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile)) {
      const where = uriToPath(uri) ?? uri;
      new Notice(`That is outside the folders in this workspace:\n${where}`);
      return null;
    }
    const workspace = this.app.workspace;
    // A plain jump reuses a tab already showing the file; an explicit new
    // tab or split always gets its own.
    let leaf = mode === false ? null : workspace.getLeaf(mode);
    if (!leaf) {
      workspace.iterateAllLeaves((candidate) => {
        if (!leaf && candidate.view instanceof CodeFileView && candidate.view.file === file) {
          leaf = candidate;
        }
      });
    }
    leaf ??= workspace.getLeaf(false);
    await leaf.openFile(file, {
      active: true,
      ...(reveal
        ? { eState: { line: reveal.line, matchStart: reveal.start, matchEnd: reveal.end } }
        : {}),
    });
    return leaf.view instanceof CodeFileView ? leaf.view : null;
  }

  // ---- the editor --------------------------------------------------------

  /**
   * The extension a code view adds for a file: the client plugin when a server
   * is running, plus the navigation keys. Null for languages nothing serves.
   */
  async extensionFor(file: TFile): Promise<Extension | null> {
    const language = languageForExtension(file.extension);
    if (!language || !this.bridge || !this.getSettings().enabled) return null;
    const located = this.locate(file.path);
    if (!located) return null;
    const session = await this.sessionFor(file);
    const navigation = this.navigationExtension(file);
    return session
      ? [session.client.plugin(located.uri, language.languageId), navigation]
      : navigation;
  }

  private navigationExtension(file: TFile): Extension {
    return [
      Prec.high(
        keymap.of([
          {
            key: "F12",
            preventDefault: true,
            run: (view) => {
              void this.goToDefinition(view, file);
              return true;
            },
          },
          {
            key: "Shift-F12",
            preventDefault: true,
            run: (view) => {
              void this.showReferences(view, file);
              return true;
            },
          },
        ]),
      ),
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          if (event.button !== 0 || !Keymap.isModifier(event, "Mod")) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return false;
          event.preventDefault();
          void this.goToDefinition(view, file, pos, event.altKey ? "split" : false);
          return true;
        },
      }),
    ];
  }

  /** Jump to the definition of the symbol at `pos` (default: the cursor). */
  async goToDefinition(
    view: EditorView,
    file: TFile,
    pos: number = view.state.selection.main.head,
    mode: LeafOpenMode = false,
  ): Promise<boolean> {
    const plugin = this.livePlugin(view);
    if (!plugin) {
      this.explainUnavailable(file);
      return false;
    }
    let ranges: LanguageRange[];
    try {
      plugin.client.sync();
      ranges = normalizeLocations(
        await plugin.client.request("textDocument/definition", {
          textDocument: { uri: plugin.uri },
          position: plugin.toPosition(pos),
        }),
      );
    } catch (error) {
      new Notice(`Could not look up the definition: ${describeError(error)}`);
      return false;
    }
    const target = ranges[0];
    if (!target) {
      new Notice("No definition found.");
      return false;
    }
    return this.revealRange(target, mode);
  }

  /** Open a location and select it. False (with a notice) outside the workspace. */
  async revealLocation(location: LanguageRange, mode: LeafOpenMode = false): Promise<boolean> {
    return this.revealRange(location, mode);
  }

  private async revealRange(range: LanguageRange, mode: LeafOpenMode): Promise<boolean> {
    const sameLine = range.start.line === range.end.line;
    const opened = await this.openUri(range.uri, mode, {
      line: range.start.line,
      start: range.start.character,
      end: sameLine ? range.end.character : Number.NaN,
    });
    return opened !== null;
  }

  /** List every reference to the symbol at the cursor in the References pane. */
  async showReferences(view: EditorView, file: TFile): Promise<boolean> {
    const plugin = this.livePlugin(view);
    if (!plugin) {
      this.explainUnavailable(file);
      return false;
    }
    const head = view.state.selection.main.head;
    const word = view.state.wordAt(head);
    const symbol = word ? view.state.sliceDoc(word.from, word.to) : "";
    let locations: LanguageLocation[];
    try {
      plugin.client.sync();
      locations = await this.describe(
        normalizeLocations(
          await plugin.client.request("textDocument/references", {
            textDocument: { uri: plugin.uri },
            position: plugin.toPosition(head),
            context: { includeDeclaration: true },
          }),
        ),
      );
    } catch (error) {
      new Notice(`Could not look up references: ${describeError(error)}`);
      return false;
    }
    const leaf = await this.app.workspace.ensureSideLeaf(REFERENCES_VIEW_TYPE, "right", {
      reveal: true,
    });
    if (leaf.view instanceof ReferencesView) leaf.view.setResult({ symbol, locations });
    return true;
  }

  /** The editor's client plugin, when the server behind it is still running. */
  private livePlugin(view: EditorView): LSPPlugin | null {
    const plugin = LSPPlugin.get(view);
    return plugin && this.byClient.get(plugin.client)?.state === "ready" ? plugin : null;
  }

  /** Say why there is no language server — once per language per session. */
  explainUnavailable(file: TFile): void {
    const availability = this.availability(file);
    let message: string | null = null;
    let key = file.extension;
    if (availability.kind === "not-installed") {
      const first = availability.candidates[0];
      key = availability.group.id;
      message = first
        ? `No ${availability.group.name} language server is installed. Install one, for example:\n${first.install}`
        : null;
    } else if (availability.kind === "failed") {
      key = availability.group.id;
      message = `The ${availability.group.name} language server could not start.\n${availability.detail}`;
    } else if (availability.kind === "no-root") {
      message = "Language servers need a folder on disk; this file is not in one.";
    } else if (availability.kind === "no-bridge") {
      message = "Language servers are only available in the desktop app.";
    } else if (availability.kind === "ready") {
      message = `${availability.server.name} is still starting.`;
      key = `starting:${availability.server.id}`;
    }
    if (!message || this.announced.has(key)) return;
    this.announced.add(key);
    new Notice(message, 8000);
  }

  private async describe(ranges: LanguageRange[]): Promise<LanguageLocation[]> {
    const texts = new Map<string, string[] | null>();
    const locations: LanguageLocation[] = [];
    for (const range of ranges) {
      const path = this.pathForUri(range.uri);
      if (!texts.has(range.uri)) {
        const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
        texts.set(
          range.uri,
          file instanceof TFile ? (await this.app.vault.cachedRead(file)).split(/\r\n?|\n/) : null,
        );
      }
      locations.push({
        ...range,
        path,
        fullPath: uriToPath(range.uri) ?? range.uri,
        text: texts.get(range.uri)?.[range.start.line] ?? null,
      });
    }
    return locations;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
