/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { beforeEach, describe, expect, it } from "vitest";
import { HOME_MOUNT_NAME, mountRegistry } from "@web/mount/MountRegistry";

/** Which repositories are in the workspace, across launches. */

// jsdom ships no localStorage; the same stub bootstrap.test.ts installs.
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
});

describe("mountRegistry", () => {
  it("names mounts after the folder and keeps them unique", () => {
    expect(mountRegistry.add("/Users/me/Projects/attention").name).toBe("attention");
    expect(mountRegistry.add("/Users/me/Projects/Memoh").name).toBe("Memoh");
    // A second folder with the same basename gets a suffix, not a collision.
    expect(mountRegistry.add("/other/place/attention").name).toBe("attention 2");
    // Home is reserved: a folder called Home cannot shadow the synced root.
    expect(mountRegistry.add(`/somewhere/${HOME_MOUNT_NAME}`).name).toBe("Home 2");
    expect(mountRegistry.list().map((record) => record.name)).toEqual([
      "attention",
      "Memoh",
      "attention 2",
      "Home 2",
    ]);
  });

  it("survives a reload, and remembers by path", () => {
    mountRegistry.add("/Users/me/Projects/attention");
    // A fresh read of the same storage — the boot path.
    expect(mountRegistry.list()).toEqual([
      { name: "attention", path: "/Users/me/Projects/attention" },
    ]);
    expect(mountRegistry.has("/Users/me/Projects/attention")).toBe(true);
    expect(mountRegistry.has("/elsewhere")).toBe(false);

    mountRegistry.remove("attention");
    expect(mountRegistry.list()).toEqual([]);
  });

  it("tolerates junk in storage rather than taking boot down", () => {
    localStorage.setItem("attention-mounts", "not json at all");
    expect(mountRegistry.list()).toEqual([]);
    localStorage.setItem("attention-mounts", JSON.stringify([{ name: "x" }, { path: "/y" }]));
    expect(mountRegistry.list()).toEqual([]);
  });
});
