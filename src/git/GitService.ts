import type { App } from "../app/App";
import type { TFile } from "../vault/TAbstractFile";

/**
 * `app.git` — read-side git access for the vault working tree, backed by the
 * preload git bridge (desktop). Browser mode reports unavailable, same
 * pattern as the terminal. Mirrors electron/git-bridge.ts structurally.
 */

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ElectronGitApi {
  available: boolean;
  exec(args: string[], cwd: string): Promise<GitExecResult>;
}

export interface GitFileStatus {
  path: string;
  /** Two-letter porcelain code, e.g. " M", "??", "A ". */
  status: string;
}

export class GitService {
  /** Swappable for tests; resolved lazily so the bridge can install first. */
  bridgeFactory: () => ElectronGitApi | null = () =>
    (globalThis as { electronGit?: ElectronGitApi }).electronGit ?? null;
  private bridgeInstance: ElectronGitApi | null | undefined;

  constructor(readonly app: App) {}

  private get bridge(): ElectronGitApi | null {
    if (this.bridgeInstance === undefined) this.bridgeInstance = this.bridgeFactory();
    return this.bridgeInstance;
  }

  isAvailable(): boolean {
    return Boolean(this.bridge?.available && this.baseDir());
  }

  /** The vault folder git runs in; null for in-memory vaults. */
  baseDir(): string | null {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    return adapter.getBasePath?.() ?? null;
  }

  async isRepository(): Promise<boolean> {
    const result = await this.exec(["rev-parse", "--is-inside-work-tree"]);
    return result?.code === 0 && result.stdout.trim() === "true";
  }

  /**
   * The file's content at HEAD; null when git is unavailable, the vault is
   * not a repository, or the file is untracked/new at HEAD.
   */
  async readHeadFile(file: TFile): Promise<string | null> {
    const result = await this.exec(["show", `HEAD:${file.path}`]);
    if (!result || result.code !== 0) return null;
    return result.stdout;
  }

  /** Working-tree changes, porcelain v1. */
  async status(): Promise<GitFileStatus[]> {
    const result = await this.exec(["status", "--porcelain"]);
    if (!result || result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .filter((line) => line.length > 3)
      .map((line) => ({ status: line.slice(0, 2), path: line.slice(3).trim().replace(/^"|"$/g, "") }));
  }

  private async exec(args: string[]): Promise<GitExecResult | null> {
    const cwd = this.baseDir();
    if (!this.bridge?.available || !cwd) return null;
    try {
      return await this.bridge.exec(args, cwd);
    } catch (error) {
      console.error("git exec failed", args, error);
      return null;
    }
  }
}
