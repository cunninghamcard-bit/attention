/**
 * Input: loro-crdt (dynamic)
 * Output: loadLoro, LoroModule
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * The one place loro-crdt enters the renderer. The import stays dynamic —
 * a 3.2 MB WASM has no business in the entry chunk (the restty precedent)
 * — and everything in the sync slice reaches loro through here, which is
 * also what lets the tests lane resolve it: resolution happens from this
 * file, inside apps/web, where the dependency lives.
 */

export type LoroModule = typeof import("loro-crdt");

let modulePromise: Promise<LoroModule> | null = null;

export function loadLoro(): Promise<LoroModule> {
  modulePromise ??= import("loro-crdt");
  return modulePromise;
}
