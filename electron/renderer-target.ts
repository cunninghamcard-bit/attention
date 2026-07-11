/**
 * Resolves where a BrowserWindow loads the reconstructed renderer from.
 *
 * - Development: the Vite dev server URL (passed via `ELECTRON_RENDERER_URL`),
 *   so `pnpm run dev:desktop` shows the live renderer with HMR.
 * - Production: `app://obsidian.md/index.html`, exactly like real Obsidian
 *   (symbol `je = se + "index.html"`). The `app://` protocol that serves it is
 *   implemented in L4; before that lands, run via the dev server.
 */
export const APP_ORIGIN = "app://obsidian.md/";
export const APP_INDEX_URL = `${APP_ORIGIN}index.html`;

export function resolveRendererUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const devUrl = env.ELECTRON_RENDERER_URL;
  if (devUrl && devUrl.length > 0) return devUrl;
  return APP_INDEX_URL;
}

export function isDevRendererTarget(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.ELECTRON_RENDERER_URL);
}
