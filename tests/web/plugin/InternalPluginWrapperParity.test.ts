import { describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { InternalPluginWrapper } from "@web/plugin/InternalPluginWrapper";

describe("InternalPluginWrapper Obsidian parity", () => {
  it("refuses to save over a config file that exists but will not parse", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new App(document.createElement("div"));
    const wrapper = new InternalPluginWrapper(
      app,
      { id: "core-corrupt-data", name: "Core Corrupt Data", defaultOn: false, init: () => {} },
      app.internalPlugins,
    );
    const read = vi.spyOn(app.vault, "readConfigJson");
    const write = vi.spyOn(app.vault, "writeConfigJson").mockResolvedValue();

    try {
      // Core plugins merge loadData over their defaults (`?? {}`) and hand the whole
      // document back to saveData. `undefined` is a file that exists but will not parse,
      // so writing that merged document would destroy a hand-repairable file.
      read.mockResolvedValue(undefined);
      expect(await wrapper.loadData()).toBeUndefined();
      await wrapper.saveData({ folder: "Daily" });

      expect(write).not.toHaveBeenCalled();

      // A missing file is safe to write, and repairing the file releases the lock.
      read.mockResolvedValue(null);
      expect(await wrapper.loadData()).toBeNull();
      await wrapper.saveData({ folder: "Daily" });

      expect(write).toHaveBeenCalledWith(
        "core-corrupt-data",
        { folder: "Daily" },
        { mtime: wrapper.lastSave },
      );
    } finally {
      read.mockRestore();
      write.mockRestore();
      consoleError.mockRestore();
    }
  });

  it("does not wait for user enable hooks before completing core plugin enablement", async () => {
    const app = new App(document.createElement("div"));
    let finishUserEnable: (() => void) | null = null;
    let enableResolved = false;
    const seen: string[] = [];
    const wrapper = new InternalPluginWrapper(
      app,
      {
        id: "core-user-enable",
        name: "Core User Enable",
        defaultOn: false,
        init: () => {},
        onEnable: () => {
          seen.push("onEnable");
        },
        onUserEnable: () => {
          seen.push("onUserEnable");
          return new Promise<void>((resolve) => {
            finishUserEnable = () => {
              seen.push("onUserEnable:done");
              resolve();
            };
          });
        },
      },
      app.internalPlugins,
    );

    wrapper.init();

    const enablePromise = wrapper.enable(true).then(() => {
      enableResolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(enableResolved).toBe(true);
    expect(wrapper.enabled).toBe(true);
    expect(seen).toEqual(["onEnable", "onUserEnable"]);

    finishUserEnable?.();
    await enablePromise;
    await Promise.resolve();

    expect(seen).toEqual(["onEnable", "onUserEnable", "onUserEnable:done"]);
  });

  it("removes core plugin commands without waiting for async disable hooks", async () => {
    const app = new App(document.createElement("div"));
    let finishDisable: (() => void) | null = null;
    let disableResolved = false;
    const seen: string[] = [];
    const wrapper = new InternalPluginWrapper(
      app,
      {
        id: "core-async-disable",
        name: "Core Async Disable",
        defaultOn: false,
        init: (_app, plugin) => {
          plugin.registerGlobalCommand({
            id: "core-async-disable:run",
            name: "Run",
            callback: () => {
              seen.push("run");
            },
          });
        },
        onDisable: () => {
          seen.push("onDisable");
          return new Promise<void>((resolve) => {
            finishDisable = () => {
              seen.push("onDisable:done");
              resolve();
            };
          });
        },
        onUserDisable: () => {
          seen.push("onUserDisable");
        },
      },
      app.internalPlugins,
    );

    wrapper.init();
    await wrapper.enable();

    expect(app.commands.findCommand("core-async-disable:run")).not.toBeUndefined();

    const disablePromise = wrapper.disable(true).then(() => {
      disableResolved = true;
    });
    await Promise.resolve();

    expect(disableResolved).toBe(true);
    expect(wrapper.enabled).toBe(false);
    expect(app.commands.findCommand("core-async-disable:run")).toBeUndefined();
    expect(seen).toEqual(["onDisable", "onUserDisable"]);

    finishDisable?.();
    await disablePromise;
    await Promise.resolve();

    expect(seen).toEqual(["onDisable", "onUserDisable", "onDisable:done"]);
  });
});
