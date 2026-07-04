import type { App } from "../app/App";

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
  /** Two-letter porcelain code (index column + worktree column), e.g. " M", "??", "A ". */
  status: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

/** Index column ≠ space/? means something is staged for this file. */
export function isStaged(status: GitFileStatus): boolean {
  return status.status[0] !== " " && status.status[0] !== "?";
}

/** Worktree column ≠ space, or untracked, means unstaged edits exist. */
export function hasUnstagedChanges(status: GitFileStatus): boolean {
  return status.status[1] !== " " || status.status[0] === "?";
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
  async readHeadFile(path: string): Promise<string | null> {
    const result = await this.exec(["show", `HEAD:${path}`]);
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

  async stage(paths: string[]): Promise<boolean> {
    if (paths.length === 0) return true;
    const result = await this.exec(["add", "--", ...paths]);
    return result?.code === 0;
  }

  async unstage(paths: string[]): Promise<boolean> {
    if (paths.length === 0) return true;
    const result = await this.exec(["restore", "--staged", "--", ...paths]);
    return result?.code === 0;
  }

  /** Commits the index. Returns the error output on failure, null on success. */
  async commit(message: string): Promise<string | null> {
    const result = await this.exec(["commit", "-m", message]);
    if (!result) return "git is not available";
    if (result.code !== 0) return result.stderr.trim() || result.stdout.trim() || `git commit exited ${result.code}`;
    this.app.workspace.trigger("git-commit", message);
    return null;
  }

  /** The staged (index) content of a file; null when nothing is staged. */
  async readIndexFile(path: string): Promise<string | null> {
    const result = await this.exec(["show", `:0:${path}`]);
    if (!result || result.code !== 0) return null;
    return result.stdout;
  }

  /** Recent commits touching `path` (or the whole repo when omitted). */
  async log(path?: string, limit = 50): Promise<GitLogEntry[]> {
    const args = ["log", `-n${limit}`, "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"];
    if (path) args.push("--follow", "--", path);
    const result = await this.exec(args);
    if (!result || result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, author, date, subject] = line.split("\x1f");
        return { hash, shortHash, author, date, subject };
      })
      .filter((entry) => entry.hash && entry.subject !== undefined);
  }

  /** File content at an arbitrary ref; null when missing at that ref. */
  async readFileAt(ref: string, path: string): Promise<string | null> {
    const result = await this.exec(["show", `${ref}:${path}`]);
    if (!result || result.code !== 0) return null;
    return result.stdout;
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
