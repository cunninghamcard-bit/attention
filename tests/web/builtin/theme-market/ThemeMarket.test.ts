import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { ThemeMarketplace, type MarketplaceFetcher } from "@web/builtin/theme-market/ThemeMarketplace";

const CATALOG = JSON.stringify([
  { name: "Minimal", author: "kepano", repo: "kepano/obsidian-minimal", modes: ["light", "dark"] },
  { name: "Things", author: "colineckert", repo: "colineckert/obsidian-things", modes: ["light"] },
]);

function fakeFetcher(routes: Record<string, string | number>): MarketplaceFetcher {
  return async (url) => {
    const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
    if (!hit || typeof hit[1] === "number") return { ok: false, status: (hit?.[1] as number) ?? 404, text: async () => "" };
    const body = hit[1];
    return { ok: true, status: 200, text: async () => body };
  };
}

describe("theme marketplace", () => {
  it("loads the community catalog and searches it", async () => {
    const market = new ThemeMarketplace(fakeFetcher({ "community-css-themes.json": CATALOG }));
    await expect(market.loadCatalog()).resolves.toBe(2);
    expect(market.search("minimal")).toHaveLength(1);
    expect(market.search("").map((entry) => entry.manifest.name)).toEqual(["Minimal", "Things"]);
    expect(market.getEntry("Minimal")?.repository).toBe("kepano/obsidian-minimal");
  });

  it("downloads theme.css and merges the remote manifest", async () => {
    const market = new ThemeMarketplace(fakeFetcher({
      "community-css-themes.json": CATALOG,
      "kepano/obsidian-minimal/HEAD/theme.css": "body { --minimal-marker: 1; }",
      "kepano/obsidian-minimal/HEAD/manifest.json": JSON.stringify({ version: "8.1.0" }),
    }));
    await market.loadCatalog();

    const pkg = await market.downloadPackage("Minimal");

    expect(pkg.cssText).toContain("--minimal-marker");
    expect(pkg.manifest.version).toBe("8.1.0");
    expect(pkg.manifest.name).toBe("Minimal");
  });

  it("installs into the vault theme folder and enables end to end", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const pkg = {
      manifest: { id: "Minimal", name: "Minimal", version: "8.1.0", author: "kepano", modes: ["light", "dark"] as Array<"light" | "dark"> },
      cssText: "body { --installed-theme-marker: yes; }",
    };

    await app.themeInstaller.install(pkg);

    const folder = `${app.customCss.getThemeFolder()}/Minimal`;
    await expect(app.vault.readText(`${folder}/theme.css`)).resolves.toContain("--installed-theme-marker");
    await expect(app.vault.readJson(`${folder}/manifest.json`)).resolves.toMatchObject({ name: "Minimal", version: "8.1.0" });
    expect(app.themes.listThemes().some((theme) => theme.id === "Minimal")).toBe(true);

    app.themeInstaller.enable("Minimal");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(app.vault.getConfig("cssTheme")).toBe("Minimal");
    expect(app.customCss.styleEl.textContent).toContain("--installed-theme-marker");
  });

  it("applies a vault theme that was installed by real Obsidian (shared vault)", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const folder = `${app.customCss.getThemeFolder()}/Shared`;
    await app.vault.writeText(`${folder}/theme.css`, "body { --shared-theme-marker: yes; }");
    await app.vault.writeJson(`${folder}/manifest.json`, { name: "Shared", version: "1.0.0" });

    await app.customCss.readThemes();
    app.themes.setTheme("Shared");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(app.customCss.styleEl.textContent).toContain("--shared-theme-marker");
  });
});
