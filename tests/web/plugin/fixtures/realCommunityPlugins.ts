import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PluginManifestInput } from "@web/plugin/PluginManifest";

export interface RealCommunityPlugin {
  repo: string;
  tag: string;
  mainJsSha256: string;
  /** First stage that still fails in attention; each gap sits outside the require("obsidian") module. */
  knownGap?: { stage: "evaluate" | "onload"; reason: string };
}

// Pinned release builds; bump tag and hash together. Third-party bundles (AGPL/MIT,
// ~4.6 MB total) are fetched and hash-checked rather than vendored into git.
export const REAL_COMMUNITY_PLUGINS: readonly RealCommunityPlugin[] = [
  {
    repo: "SilentVoid13/Templater",
    tag: "2.26.0",
    mainJsSha256: "0acd45cfdb3a7337e2bef511699bc1f819dc64645ad3480df33579d42d2dcbaa",
    knownGap: {
      stage: "evaluate",
      reason:
        "main.js calls window.CodeMirror.defineMode at top level; attention ships no CodeMirror 5 global",
    },
  },
  {
    repo: "Vinzent03/obsidian-git",
    tag: "2.41.1",
    mainJsSha256: "28a18afcab1d2f152a0d3c89aff38e2a97ad0be1aeaaf99630613233bbec6c1b",
    knownGap: {
      stage: "onload",
      reason:
        "init calls app.vault.adapter.getBasePath(), which the mount-backed vault adapter lacks",
    },
  },
  {
    repo: "obsidian-tasks-group/obsidian-tasks",
    tag: "8.5.0",
    mainJsSha256: "f901cc5537518787cd07db251d8b0db43491a127440d1b415f9cae950fbb587b",
  },
  {
    repo: "YishenTu/claudian",
    tag: "2.3.22",
    mainJsSha256: "02ac5d0e8f837a3d0167cc29b03c686bcd70205941135997ceb12516d08db654",
  },
];

const CACHE_DIR = resolve(
  import.meta.dirname,
  "../../../../node_modules/.cache/real-community-plugins",
);

async function fetchReleaseAsset(plugin: RealCommunityPlugin, name: string): Promise<string> {
  const cachePath = resolve(CACHE_DIR, plugin.repo.replace("/", "__"), plugin.tag, name);
  const cached = await readFile(cachePath, "utf8").catch(() => null);
  if (cached !== null) return cached;
  const url = `https://github.com/${plugin.repo}/releases/download/${plugin.tag}/${name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  const text = await response.text();
  await mkdir(resolve(cachePath, ".."), { recursive: true });
  await writeFile(cachePath, text);
  return text;
}

export async function loadRealCommunityPlugin(
  plugin: RealCommunityPlugin,
): Promise<{ manifest: PluginManifestInput; mainJs: string }> {
  const [mainJs, manifestJson] = await Promise.all([
    fetchReleaseAsset(plugin, "main.js"),
    fetchReleaseAsset(plugin, "manifest.json"),
  ]);
  const sha256 = createHash("sha256").update(mainJs).digest("hex");
  if (sha256 !== plugin.mainJsSha256) {
    throw new Error(
      `${plugin.repo}@${plugin.tag} main.js sha256 ${sha256} is not the pinned build`,
    );
  }
  return { manifest: JSON.parse(manifestJson) as PluginManifestInput, mainJs };
}
