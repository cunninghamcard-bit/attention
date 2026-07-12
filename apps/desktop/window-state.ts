import type { JsonStore } from "./json-store";

/**
 * Per-vault window state, persisted as `userData/<vaultId>.json`
 * (reverse note "Settings and per-window state"):
 * `{ x, y, width, height, isMaximized, devTools, zoom }`.
 */
export interface WindowState {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isMaximized?: boolean;
  devTools?: boolean;
  zoom?: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The slice of Electron's `screen` module that `fe()` consults (injectable for tests). */
export interface DisplayProvider {
  getPrimaryWorkArea(): Rect;
  getAllWorkAreas(): Rect[];
}

export function loadWindowState(store: JsonStore, vaultId: string): WindowState {
  return store.read<WindowState>(vaultId, {});
}

export function saveWindowState(store: JsonStore, vaultId: string, state: WindowState): void {
  store.write(vaultId, state);
}

/**
 * Real `fe(state)` — validate stored bounds against the current displays and
 * produce BrowserWindow bounds:
 *
 * - default size: min(1024, workArea.width) × min(800, workArea.height - 1);
 * - saved x/y/w/h accepted only if the rect overlaps some display work area
 *   (2px tolerance on every edge);
 * - size-only state (x/y undefined, w/h defined) is accepted as size-only;
 * - floors: width ≥ 300, height ≥ 200.
 */
export function resolveWindowBounds(
  state: WindowState,
  displays: DisplayProvider,
): { x?: number; y?: number; width: number; height: number } {
  const result: { x?: number; y?: number; width: number; height: number } = {
    width: 800,
    height: 600,
  };
  try {
    const workArea = displays.getPrimaryWorkArea();
    result.width = Math.min(1024, workArea.width);
    result.height = Math.min(800, workArea.height - 1);
  } catch {
    // Screen info unavailable (headless tests) — keep 800x600.
  }

  let useSaved = false;
  if (
    state.x !== undefined &&
    state.y !== undefined &&
    state.width !== undefined &&
    state.height !== undefined
  ) {
    try {
      for (const area of displays.getAllWorkAreas()) {
        if (
          state.x < area.x + area.width - 2 &&
          state.x + state.width > area.x + 2 &&
          state.y < area.y + area.height - 2 &&
          state.y + state.height > area.y + 2
        ) {
          useSaved = true;
          break;
        }
      }
    } catch {
      // Ignore display errors, fall back to defaults.
    }
  } else if (
    state.x === undefined &&
    state.y === undefined &&
    state.width !== undefined &&
    state.height !== undefined
  ) {
    useSaved = true;
  }

  if (useSaved) {
    if (state.x !== undefined) result.x = state.x;
    if (state.y !== undefined) result.y = state.y;
    result.width = state.width as number;
    result.height = state.height as number;
  }
  if (result.width < 300) result.width = 300;
  if (result.height < 200) result.height = 200;
  return result;
}
