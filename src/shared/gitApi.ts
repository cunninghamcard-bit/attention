/**
 * Native-seam port: the git working-tree bridge.
 *
 * ONE definition of the contract. The shell fills it in the preload
 * (`git-bridge.ts` → the injected `electronGit` global); the renderer's
 * `GitService` consumes it. Both sides import from here instead of
 * re-declaring the shape and agreeing by convention.
 */

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ElectronGitApi {
  available: boolean;
  exec(args: string[], cwd: string): Promise<GitExecResult>;
  /** GitHub CLI; optional so older bridges and test fakes keep working. */
  execGh?(args: string[], cwd: string, input?: string): Promise<GitExecResult>;
}
