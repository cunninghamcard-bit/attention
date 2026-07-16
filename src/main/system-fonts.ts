/**
 * Main-process system font enumeration.
 *
 * Obsidian ships a proprietary native addon named `get-fonts`. That package is
 * UNLICENSED and cannot be copied. This module provides the same role through
 * the open-source `font-list` package and is exposed to the renderer as the
 * `get-fonts` IPC channel.
 */

export async function listSystemFontFamilies(): Promise<string[]> {
  try {
    const { getFonts } = await import("font-list");
    const fonts = await getFonts({ disableQuoting: true });
    if (!Array.isArray(fonts)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const font of fonts) {
      const name = String(font).trim().replace(/^"|"$/g, "");
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}
