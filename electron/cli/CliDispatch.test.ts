import { describe, expect, it, vi } from "vitest";
import { dispatchCli, type CliDispatchDeps } from "./CliDispatch";
import { routeVault } from "./CliVaultRouter";

function makeDeps(overrides: Partial<CliDispatchDeps> = {}): CliDispatchDeps {
  return {
    getIdByName: (name) => (name === "Work" ? "vault-work" : null),
    getIdByContainedPath: (path) => (path.startsWith("/vaults/notes") ? "vault-notes" : null),
    mostRecentVaultId: () => "vault-recent",
    openStarter: vi.fn(),
    handleUrl: (url) => `Processed URI ${url}`,
    executeCliRequest: vi.fn(async (vaultId, argv) => `ran ${vaultId} ${argv.join(",")}`),
    ...overrides,
  };
}

describe("routeVault", () => {
  it("vault=<name> resolves by name and strips the prefix", () => {
    const deps = makeDeps();
    expect(routeVault(["vault=Work", "files"], "/anywhere", deps)).toEqual({ vaultId: "vault-work", argv: ["files"] });
  });

  it("falls back to the cwd's vault, then the most recent", () => {
    const deps = makeDeps();
    expect(routeVault(["files"], "/vaults/notes/sub", deps)).toEqual({ vaultId: "vault-notes", argv: ["files"] });
    expect(routeVault(["files"], "/tmp", deps)).toEqual({ vaultId: "vault-recent", argv: ["files"] });
  });
});

describe("dispatchCli", () => {
  it("routes a command to the vault renderer", async () => {
    const deps = makeDeps();
    const out = await dispatchCli({ argv: ["vault=Work", "files", "ext=ts"], tty: false, cwd: "/x" }, deps);
    expect(out).toBe("ran vault-work files,ext=ts");
    expect(deps.openStarter).not.toHaveBeenCalled();
  });

  it("opens the Starter on empty non-tty argv, then still dispatches (help)", async () => {
    const deps = makeDeps();
    await dispatchCli({ argv: [], tty: false, cwd: "/tmp" }, deps);
    expect(deps.openStarter).toHaveBeenCalledOnce();
    expect(deps.executeCliRequest).toHaveBeenCalledWith("vault-recent", []);
  });

  it("does not open the Starter for a tty request", async () => {
    const deps = makeDeps();
    await dispatchCli({ argv: [], tty: true, cwd: "/tmp" }, deps);
    expect(deps.openStarter).not.toHaveBeenCalled();
  });

  it("short-circuits a trailing obsidian:// URL to the URL router", async () => {
    const deps = makeDeps();
    const out = await dispatchCli({ argv: ["obsidian://open?file=A"], tty: false, cwd: "/x" }, deps);
    expect(out).toBe("Processed URI obsidian://open?file=A");
    expect(deps.executeCliRequest).not.toHaveBeenCalled();
  });
});
