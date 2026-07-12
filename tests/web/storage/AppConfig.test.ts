import { describe, expect, it } from "vitest";
import { AppConfigManager } from "@web/storage/AppConfig";
import { JsonStore } from "@web/storage/JsonStore";

describe("AppConfigManager", () => {
  it("loads app and appearance config with app values taking precedence", async () => {
    const store = new JsonStore();
    await store.write("appearance.json", {
      theme: "moonstone",
      accentColor: "#fff",
      editorFontFamily: "Legacy",
    });
    await store.write("app.json", { theme: "obsidian", hotkeys: { hotkeys: {} } });
    const config = new AppConfigManager(store);

    await config.load();

    expect(config.get("theme")).toBe("obsidian");
    expect(config.get("accentColor")).toBe("#fff");
    expect(config.get("textFontFamily")).toBe("Legacy");
    expect(config.getAll()).not.toHaveProperty("editorFontFamily");
  });

  it("saves appearance keys to appearance.json and other app keys to app.json", async () => {
    const store = new JsonStore();
    const config = new AppConfigManager(store);
    await config.load();
    await config.set("theme", "moonstone");
    await config.set("accentColor", "#123456");
    await config.set("hotkeys", { hotkeys: { "app:open": [{ modifiers: ["Mod"], key: "O" }] } });

    expect(await store.read("appearance.json")).toEqual({
      theme: "moonstone",
      accentColor: "#123456",
    });
    expect(await store.read("app.json")).toEqual({
      hotkeys: { hotkeys: { "app:open": [{ modifiers: ["Mod"], key: "O" }] } },
    });
  });

  it("reloads changed app and appearance config from raw file updates", async () => {
    const store = new JsonStore();
    await store.write(
      "appearance.json",
      { theme: "moonstone", accentColor: "#fff" },
      { mtime: 100 },
    );
    await store.write("app.json", { hotkeys: { hotkeys: {} } }, { mtime: 100 });
    const config = new AppConfigManager(store);
    await config.load();
    const changed: string[] = [];
    config.on("config-changed", (key) => changed.push(String(key)));

    await store.write("appearance.json", { theme: "obsidian" }, { mtime: Date.now() + 1_000 });
    await store.write("app.json", { communityPlugins: ["sample"] }, { mtime: Date.now() + 1_000 });
    await config.reload();

    expect(config.get("theme")).toBe("obsidian");
    expect(config.get("communityPlugins")).toEqual(["sample"]);
    expect(config.get("accentColor")).toBeUndefined();
    expect(config.get("hotkeys")).toBeUndefined();
    expect(changed.sort()).toEqual(["accentColor", "communityPlugins", "hotkeys", "theme"]);
  });

  it("emits config-changed for direct set operations without reloading its own save", async () => {
    const store = new JsonStore();
    const config = new AppConfigManager(store);
    await config.load();
    const changed: string[] = [];
    config.on("config-changed", (key) => changed.push(String(key)));

    await config.set("theme", "moonstone");
    await config.reload();

    expect(changed).toEqual(["theme"]);
  });
});
