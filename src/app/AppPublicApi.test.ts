import { beforeEach, describe, expect, it, vi } from "vitest";
import { createObsidianPluginModule } from "../api/ObsidianPluginModule";
import { RenderContext } from "../markdown/RenderContext";
import { SecretStorage } from "../storage/SecretStorage";
import { App } from "./App";

describe("App public plugin API", () => {
  beforeEach(() => {
    document.body.classList.remove("theme-dark", "theme-light");
    document.body.style.removeProperty("--text-on-accent");
    document.body.style.removeProperty("--accent-h");
    document.body.style.removeProperty("--accent-s");
    document.body.style.removeProperty("--accent-l");
    document.body.style.removeProperty("--font-interface-override");
    document.body.style.removeProperty("--font-text-override");
    document.body.style.removeProperty("--font-print-override");
    document.body.style.removeProperty("--font-monospace-override");
    document.body.style.removeProperty("--font-text-size");
    document.body.style.removeProperty("--indent-size");
    document.documentElement.style.removeProperty("--interactive-accent");
    document.documentElement.style.removeProperty("font-size");
  });

  it("exposes the app render context and dark-mode helper", () => {
    const app = new App(document.createElement("div"));

    expect(app.renderContext).toBeInstanceOf(RenderContext);
    expect(app.renderContext.app).toBe(app);
    expect(app.renderContext.sourcePath).toBe("");
    expect(app.renderContext.containerEl).toBe(app.containerEl);
    expect(app.isDarkMode()).toBe(false);

    app.appearance.setBaseTheme("obsidian");
    expect(app.isDarkMode()).toBe(true);

    app.appearance.setBaseTheme("moonstone");
    expect(app.isDarkMode()).toBe(false);
  });

  it("exposes the Obsidian App theme facade over AppearanceManager", () => {
    const app = new App(document.createElement("div"));
    const cssChange = vi.fn();
    app.workspace.on("css-change", cssChange);

    expect(app.getTheme()).toBe("moonstone");

    app.changeTheme("obsidian");

    expect(app.vault.getConfig("theme")).toBe("obsidian");
    expect(app.isDarkMode()).toBe(true);
    expect(app.getTheme()).toBe("obsidian");
    expect(document.body.classList.contains("theme-dark")).toBe(true);
    expect(document.body.classList.contains("theme-light")).toBe(false);
    expect(cssChange).toHaveBeenCalled();

    cssChange.mockClear();
    app.vault.setConfig("theme", "moonstone");
    app.updateTheme();

    expect(app.getTheme()).toBe("moonstone");
    expect(document.body.classList.contains("theme-light")).toBe(true);
    expect(document.body.classList.contains("theme-dark")).toBe(false);
    expect(cssChange).toHaveBeenCalled();
  });

  it("exposes the Obsidian App accent color facade over body CSS variables", () => {
    const app = new App(document.createElement("div"));
    const initialAccentConfig = app.vault.getConfig("accentColor");

    app.setAccentColor("#ffffff");

    expect(document.body.style.getPropertyValue("--accent-h")).toBe("0");
    expect(document.body.style.getPropertyValue("--accent-s")).toBe("0%");
    expect(document.body.style.getPropertyValue("--accent-l")).toBe("100%");
    expect(document.body.style.getPropertyValue("--text-on-accent")).toBe("var(--text-on-accent-inverted)");
    expect(app.vault.getConfig("accentColor")).toBe(initialAccentConfig);

    app.vault.setConfig("accentColor", "#123456");
    app.updateAccentColor();

    expect(app.getAccentColor()).toBe("#123456");
    expect(document.body.style.getPropertyValue("--accent-h")).toBe("210");
    expect(document.body.style.getPropertyValue("--accent-s")).toBe("65%");
    expect(document.body.style.getPropertyValue("--accent-l")).toBe("20%");
    expect(document.body.style.getPropertyValue("--text-on-accent")).toBe("");

    app.vault.setConfig("accentColor", "");
    document.body.style.setProperty("--accent-h", "0");
    document.body.style.setProperty("--accent-s", "0%");
    document.body.style.setProperty("--accent-l", "100%");
    expect(app.getAccentColor()).toBe("#ffffff");

    app.setAccentColor("");

    expect(document.body.style.getPropertyValue("--accent-h")).toBe("");
    expect(document.body.style.getPropertyValue("--accent-s")).toBe("");
    expect(document.body.style.getPropertyValue("--accent-l")).toBe("");
    expect(document.body.style.getPropertyValue("--text-on-accent")).toBe("");
  });

  it("exposes Obsidian App typography and layout display updaters", () => {
    const app = new App(document.createElement("div"));
    const cssChange = vi.fn();
    app.workspace.on("css-change", cssChange);

    app.vault.setConfig("interfaceFontFamily", "Avenir Next, system-ui");
    app.vault.setConfig("textFontFamily", "Iowan Old Style");
    app.vault.setConfig("monospaceFontFamily", "JetBrains Mono");
    app.updateFontFamily();

    expect(document.body.style.getPropertyValue("--font-interface-override")).toBe("\"Avenir Next\", system-ui");
    expect(document.body.style.getPropertyValue("--font-text-override")).toBe("\"Iowan Old Style\"");
    expect(document.body.style.getPropertyValue("--font-print-override")).toBe("\"Iowan Old Style\"");
    expect(document.body.style.getPropertyValue("--font-monospace-override")).toBe("\"JetBrains Mono\"");

    app.vault.setConfig("baseFontSize", 42);
    app.updateFontSize();

    expect(document.body.style.getPropertyValue("--font-text-size")).toBe("30px");
    expect(document.documentElement.style.getPropertyValue("font-size")).toBe("30px");

    app.vault.setConfig("tabSize", 8);
    app.updateTabSize();

    expect(document.body.style.getPropertyValue("--indent-size")).toBe("8");

    app.vault.setConfig("showViewHeader", false);
    app.updateViewHeaderDisplay();
    expect(document.body.classList.contains("show-view-header")).toBe(false);

    app.vault.setConfig("showRibbon", false);
    app.updateRibbonDisplay();
    expect(document.body.classList.contains("show-ribbon")).toBe(false);

    app.vault.setConfig("showInlineTitle", true);
    app.updateInlineTitleDisplay();
    expect(document.body.classList.contains("show-inline-title")).toBe(true);

    app.vault.setConfig("floatingNavigation", true);
    app.updateFloatingNavigationDisplay();
    expect(document.body.classList.contains("is-floating-nav")).toBe(true);

    app.vault.setConfig("autoFullScreen", true);
    app.updateAutoFullScreenDisplay();
    expect(document.body.classList.contains("auto-full-screen")).toBe(true);
    expect(cssChange).toHaveBeenCalled();
  });

  it("provides SecretStorage on the app", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);

    expect(app.secretStorage).toBeInstanceOf(SecretStorage);
    expect(module.SecretStorage).toBe(SecretStorage);
    app.secretStorage.setSecret("api-key", "secret");

    expect(app.secretStorage.getSecret("api-key")).toBe("secret");
    expect(app.secretStorage.listSecrets()).toContain("api-key");
  });

  it("validates secret IDs and persists secrets across storage instances", () => {
    const storage = new SecretStorage();

    storage.setSecret("agent-token", "abc");

    expect(() => storage.setSecret("AgentToken", "abc")).toThrow(/Invalid secret ID/);
    expect(new SecretStorage().getSecret("agent-token")).toBe("abc");
  });
});
