import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonStore } from "@desktop/json-store";
import { VaultRegistry } from "@desktop/vault-registry";
import { handleObsidianUrl, obsidianUrlFromArgv } from "@desktop/obsidian-protocol";
import type { ObsidianAction } from "@desktop/obsidian-url";
import type { ObsidianSettings } from "@desktop/settings";

let dir: string;
let registry: VaultRegistry;
let deliverAction: ReturnType<typeof vi.fn<(vaultId: string, action: ObsidianAction) => void>>;
let mostRecent: string | null;
let openAllPersisted: ReturnType<typeof vi.fn<() => number>>;
let openStarter: ReturnType<typeof vi.fn<() => void>>;
let showVaultNotFound: ReturnType<typeof vi.fn<(url: string) => void>>;
let vaultId: string;

function dispatch(url: string) {
  handleObsidianUrl(url, {
    registry,
    vaultWindows: {
      deliverAction,
      mostRecentVaultId: () => mostRecent,
      openAllPersisted,
    },
    openStarter,
    showVaultNotFound,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "obs-proto-"));
  const store = new JsonStore(join(dir, "userData"));
  const settings: ObsidianSettings = {};
  registry = new VaultRegistry(settings, store, () => {});
  const vaultPath = join(dir, "Notes");
  fs.mkdirSync(vaultPath);
  vaultId = (registry.registerPath(vaultPath) as { id: string }).id;
  deliverAction = vi.fn<(v: string, a: ObsidianAction) => void>();
  mostRecent = null;
  openAllPersisted = vi.fn<() => number>(() => 0);
  openStarter = vi.fn<() => void>();
  showVaultNotFound = vi.fn<(url: string) => void>();
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("handleObsidianUrl (real $e end to end)", () => {
  it("ignores non-obsidian URLs", () => {
    dispatch("https://x");
    expect(deliverAction).not.toHaveBeenCalled();
    expect(showVaultNotFound).not.toHaveBeenCalled();
  });

  it("opens the starter for sync-setup", () => {
    dispatch("workbench://sync-setup");
    expect(openStarter).toHaveBeenCalled();
  });

  it("delivers an open action to the vault resolved by name", () => {
    dispatch("workbench://open?vault=notes&file=Daily");
    expect(deliverAction).toHaveBeenCalledWith(vaultId, expect.objectContaining({ file: "Daily" }));
  });

  it("delivers to the vault containing the path, with a relative file", () => {
    const notePath = join(dir, "Notes", "sub", "n.md");
    dispatch(`workbench://open?path=${encodeURIComponent(notePath)}`);
    expect(deliverAction).toHaveBeenCalledWith(vaultId, expect.objectContaining({ file: "/sub/n.md" }));
  });

  it("uses the most-recent vault when none is specified", () => {
    mostRecent = vaultId;
    dispatch("workbench://search?query=x");
    expect(deliverAction).toHaveBeenCalledWith(vaultId, expect.objectContaining({ action: "search" }));
  });

  it("opens persisted vaults then retries most-recent when none is open", () => {
    let opened = false;
    openAllPersisted.mockImplementation(() => {
      opened = true;
      return 1;
    });
    // mostRecent starts null; becomes the vault only after openAllPersisted runs.
    handleObsidianUrl("workbench://command?id=x", {
      registry,
      vaultWindows: {
        deliverAction,
        mostRecentVaultId: () => (opened ? vaultId : null),
        openAllPersisted,
      },
      openStarter,
      showVaultNotFound,
    });
    expect(openAllPersisted).toHaveBeenCalled();
    expect(deliverAction).toHaveBeenCalledWith(vaultId, expect.anything());
  });

  it("reports vault-not-found when nothing resolves", () => {
    dispatch("workbench://open?vault=ghost");
    expect(deliverAction).not.toHaveBeenCalled();
    expect(showVaultNotFound).toHaveBeenCalledWith("workbench://open?vault=ghost");
  });
});

describe("obsidianUrlFromArgv", () => {
  it("returns a trailing workbench:// argument", () => {
    expect(obsidianUrlFromArgv(["electron", ".", "workbench://open?x=1"])).toBe("workbench://open?x=1");
  });
  it("returns null when absent", () => {
    expect(obsidianUrlFromArgv(["electron", "."])).toBeNull();
  });
});
