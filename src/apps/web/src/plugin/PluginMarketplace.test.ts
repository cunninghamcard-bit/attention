import { describe, expect, it } from "vitest";
import { PluginMarketplace } from "./PluginMarketplace";

describe("PluginMarketplace", () => {
  it("imports Obsidian community plugin catalog data with stats and deprecations", () => {
    const marketplace = new PluginMarketplace();

    marketplace.registerObsidianReleaseData([
      {
        id: "sample",
        name: "Sample Plugin",
        author: "Ada",
        description: "Catalog entry",
        repo: "ada/sample-plugin",
      },
    ], {
      sample: {
        downloads: 12345,
        updated: Date.UTC(2026, 5, 20),
        "1.0.0": 10,
        "1.2.0": 20,
        "2.0.0": 1,
      },
    }, {
      sample: ["2.0.0"],
    });

    const entry = marketplace.getEntry("sample");

    expect(entry?.manifest).toMatchObject({
      id: "sample",
      name: "Sample Plugin",
      version: "1.2.0",
      author: "Ada",
      description: "Catalog entry",
    });
    expect(entry?.repo).toBe("ada/sample-plugin");
    expect(entry?.repository).toBe("https://github.com/ada/sample-plugin");
    expect(entry?.downloads).toBe(12345);
    expect(entry?.updatedAt).toBe("2026-06-20");
    expect(entry?.deprecatedVersions).toEqual(["2.0.0"]);
  });

  it("loads Obsidian release JSON files through a data source", async () => {
    const requested: string[] = [];
    const marketplace = new PluginMarketplace({
      async fetchJson<T>(url: string): Promise<T> {
        requested.push(url);
        if (url.endsWith("community-plugins.json")) {
          return [{
            id: "remote",
            name: "Remote Plugin",
            author: "Grace",
            description: "Loaded remotely",
            repo: "grace/remote-plugin",
          }] as T;
        }
        if (url.endsWith("community-plugin-stats.json")) {
          return {
            remote: {
              downloads: 77,
              updated: Date.UTC(2026, 0, 1),
              "0.1.0": 1,
            },
          } as T;
        }
        return {} as T;
      },
    });

    await marketplace.loadObsidianReleases();

    expect(requested).toHaveLength(3);
    expect(marketplace.search({ query: "grace/remote" })[0]?.manifest.id).toBe("remote");
    expect(marketplace.createPackage("remote")?.source).toMatchObject({
      repo: "grace/remote-plugin",
      version: "0.1.0",
      manifestUrl: "https://github.com/grace/remote-plugin/releases/download/0.1.0/manifest.json",
      mainJsUrl: "https://github.com/grace/remote-plugin/releases/download/0.1.0/main.js",
      stylesUrl: "https://github.com/grace/remote-plugin/releases/download/0.1.0/styles.css",
    });
    expect(marketplace.loadState).toBe("loaded");
    expect(marketplace.loadedAt).toEqual(expect.any(String));
  });

  it("records catalog load failures and can retry", async () => {
    let failed = false;
    const marketplace = new PluginMarketplace({
      async fetchJson<T>(url: string): Promise<T> {
        if (!failed) {
          failed = true;
          throw new Error("offline");
        }
        if (url.endsWith("community-plugins.json")) {
          return [{ id: "retry", name: "Retry Plugin", author: "Ada", description: "Works", repo: "ada/retry" }] as T;
        }
        return {} as T;
      },
    });

    await expect(marketplace.loadObsidianReleases()).rejects.toThrow("offline");

    expect(marketplace.loadState).toBe("error");
    expect(marketplace.loadError).toBe("offline");

    await marketplace.reloadObsidianReleases();

    expect(marketplace.loadState).toBe("loaded");
    expect(marketplace.getEntry("retry")?.manifest.name).toBe("Retry Plugin");
  });

  it("loads and caches plugin README markdown from the repository", async () => {
    const requested: string[] = [];
    const marketplace = new PluginMarketplace({
      async fetchJson<T>(): Promise<T> {
        return {} as T;
      },
      async fetchText(url: string): Promise<string> {
        requested.push(url);
        return "# Remote README";
      },
    });
    marketplace.registerEntry({
      manifest: {
        id: "readme",
        name: "Readme Plugin",
        version: "1.0.0",
      },
      repo: "ada/readme-plugin",
    });

    await expect(marketplace.loadReadme("readme")).resolves.toBe("# Remote README");
    await expect(marketplace.loadReadme("readme")).resolves.toBe("# Remote README");

    expect(requested).toEqual(["https://raw.githubusercontent.com/ada/readme-plugin/HEAD/README.md"]);
    expect(marketplace.getEntry("readme")?.readmeState).toBe("loaded");
  });

  it("resolves the newest plugin version compatible with the app", async () => {
    const requested: string[] = [];
    const marketplace = new PluginMarketplace({
      async fetchJson<T>(url: string): Promise<T> {
        requested.push(url);
        if (url.endsWith("manifest.json")) {
          return {
            id: "compat",
            name: "Compat Plugin",
            version: "2.0.0",
            minAppVersion: "2.0.0",
          } as T;
        }
        if (url.endsWith("versions.json")) {
          return {
            "1.0.0": "0.9.0",
            "1.5.0": "1.0.0",
            "2.0.0": "2.0.0",
          } as T;
        }
        return {} as T;
      },
    });
    marketplace.registerEntry({
      manifest: {
        id: "compat",
        name: "Compat Plugin",
        version: "2.0.0",
      },
      repo: "ada/compat",
    });

    await expect(marketplace.resolveLatestCompatibleVersion("compat", "1.0.0")).resolves.toBe("1.5.0");

    expect(requested).toEqual([
      "https://raw.githubusercontent.com/ada/compat/HEAD/manifest.json",
      "https://raw.githubusercontent.com/ada/compat/HEAD/versions.json",
    ]);
    expect(marketplace.createPackage("compat")?.source?.version).toBe("1.5.0");
    expect(marketplace.createPackage("compat")?.source?.manifestUrl).toBe("https://github.com/ada/compat/releases/download/1.5.0/manifest.json");
  });
});
