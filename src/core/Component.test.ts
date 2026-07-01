import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { Plugin } from "../plugin/Plugin";
import { Component } from "./Component";

class RecordingComponent extends Component {
  constructor(
    readonly name: string,
    readonly log: string[],
    readonly onloadResult: (() => unknown) | null = null,
    readonly onunloadResult: (() => void | Promise<void>) | null = null,
  ) {
    super();
  }

  override onload(): void | Promise<void> {
    this.log.push(`${this.name}:load`);
    return this.onloadResult?.() as void | Promise<void>;
  }

  override onunload(): void | Promise<void> {
    this.log.push(`${this.name}:unload`);
    return this.onunloadResult?.();
  }
}

class RecordingPlugin extends Plugin {
  constructor(readonly testApp: App, readonly log: string[], readonly resolveOnload: Promise<void>) {
    super(testApp, { id: "recording-plugin", name: "Recording Plugin", version: "1.0.0" });
  }

  override async onload(): Promise<void> {
    this.log.push("plugin:load");
    await this.resolveOnload;
    this.log.push("plugin:load:done");
  }
}

describe("Component lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("loads Component children without waiting for an async parent onload", async () => {
    const log: string[] = [];
    let resolveParent!: () => void;
    const parent = new RecordingComponent("parent", log, () => new Promise<void>((resolve) => {
      resolveParent = resolve;
    }));
    parent.addChild(new RecordingComponent("child", log));

    const loaded = parent.load();

    expect(log).toEqual(["parent:load", "child:load"]);
    resolveParent();
    await loaded;
    expect(parent._loaded).toBe(true);
  });

  it("returns a promise when Component onload or child load returns any truthy value", async () => {
    const log: string[] = [];
    const parent = new RecordingComponent("parent", log, () => true);
    parent.addChild(new RecordingComponent("child", log, () => ({ ok: true })));

    const loaded = parent.load();

    expect(loaded).toBeInstanceOf(Promise);
    await expect(loaded).resolves.toEqual([true, [{ ok: true }]]);
    expect(log).toEqual(["parent:load", "child:load"]);
  });

  it("unloads children and registered callbacks in LIFO order before onunload", () => {
    const log: string[] = [];
    const parent = new RecordingComponent("parent", log);
    parent.addChild(new RecordingComponent("child-a", log));
    parent.addChild(new RecordingComponent("child-b", log));
    parent.register(() => log.push("cleanup-a"));
    parent.register(() => log.push("cleanup-b"));

    parent.load();
    parent.unload();

    expect(log).toEqual([
      "parent:load",
      "child-a:load",
      "child-b:load",
      "child-b:unload",
      "child-a:unload",
      "cleanup-b",
      "cleanup-a",
      "parent:unload",
    ]);
    expect(parent._children).toEqual([]);
    expect(parent._events).toEqual([]);
  });

  it("removes a child immediately and does not unload it again with the parent", () => {
    const log: string[] = [];
    const parent = new RecordingComponent("parent", log);
    const child = parent.addChild(new RecordingComponent("child", log));

    parent.load();
    parent.removeChild(child);
    parent.unload();

    expect(log).toEqual(["parent:load", "child:load", "child:unload", "parent:unload"]);
  });

  it("cleans registered DOM events and intervals on unload", () => {
    const log: string[] = [];
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const component = new RecordingComponent("component", log);
    const button = document.createElement("button");
    const intervalId = window.setInterval(() => {}, 1000);

    component.load();
    component.registerDomEvent(button, "click", () => log.push("click"));
    component.registerDomEvent(window, "resize", () => log.push("resize"), true);
    component.registerDomEvent(document, "visibilitychange", () => log.push("visibility"), false);
    expect(component.registerInterval(intervalId)).toBe(intervalId);
    button.click();
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("visibilitychange"));
    component.unload();
    button.click();
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(log).toEqual(["component:load", "click", "resize", "visibility", "component:unload"]);
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
  });

  it("loads community Plugin children without waiting for an async plugin onload", async () => {
    const app = new App(document.createElement("div"));
    const log: string[] = [];
    let resolveOnload!: () => void;
    const plugin = new RecordingPlugin(app, log, new Promise<void>((resolve) => {
      resolveOnload = resolve;
    }));
    plugin.addChild(new RecordingComponent("child", log));

    const loaded = plugin.load();

    expect(log).toEqual(["plugin:load", "child:load"]);
    resolveOnload();
    await loaded;
    expect(log).toEqual(["plugin:load", "child:load", "plugin:load:done"]);
  });

  it("does not wait for async onunload before continuing cleanup", async () => {
    const log: string[] = [];
    let resolveUnload!: () => void;
    const component = new RecordingComponent("component", log, null, () => new Promise<void>((resolve) => {
      resolveUnload = resolve;
    }).then(() => {
      log.push("component:unload:done");
    }));

    component.load();
    const result = component.unload();

    expect(result).toBeUndefined();
    expect(log).toEqual(["component:load", "component:unload"]);
    resolveUnload();
    await Promise.resolve();
    expect(log).toEqual(["component:load", "component:unload", "component:unload:done"]);
  });
});
