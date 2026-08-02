import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleObsidianUrl, obsidianUrlFromArgv } from "@desktop/obsidian-protocol";
import type { ObsidianAction } from "@desktop/obsidian-url";

let deliverAction: ReturnType<typeof vi.fn<(action: ObsidianAction) => void>>;
let openStarter: ReturnType<typeof vi.fn<() => void>>;

function dispatch(url: string) {
  handleObsidianUrl(url, { deliverAction, openStarter });
}

beforeEach(() => {
  deliverAction = vi.fn<(a: ObsidianAction) => void>();
  openStarter = vi.fn<() => void>();
});

describe("handleObsidianUrl (real $e, one-window form)", () => {
  it("ignores non-obsidian URLs", () => {
    dispatch("https://x");
    expect(deliverAction).not.toHaveBeenCalled();
    expect(openStarter).not.toHaveBeenCalled();
  });

  it("opens the starter for sync-setup / choose-vault", () => {
    dispatch("attention://sync-setup");
    dispatch("attention://choose-vault");
    expect(openStarter).toHaveBeenCalledTimes(2);
    expect(deliverAction).not.toHaveBeenCalled();
  });

  it("delivers every action to THE window — vault params pass through", () => {
    // Real resolved a vault id here; there is nothing to resolve any more.
    // The renderer interprets vault/path against its mounts.
    dispatch("attention://open?vault=notes&file=Daily");
    expect(deliverAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "open", vault: "notes", file: "Daily" }),
    );

    dispatch("attention://search?query=x");
    expect(deliverAction).toHaveBeenCalledWith(expect.objectContaining({ action: "search" }));

    dispatch("attention:///Users/me/note.md");
    expect(deliverAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "open", path: "/Users/me/note.md" }),
    );
  });
});

describe("obsidianUrlFromArgv", () => {
  it("returns a trailing attention:// argument", () => {
    expect(obsidianUrlFromArgv(["electron", ".", "attention://open?x=1"])).toBe(
      "attention://open?x=1",
    );
  });
  it("returns null when absent", () => {
    expect(obsidianUrlFromArgv(["electron", "."])).toBeNull();
  });
});
