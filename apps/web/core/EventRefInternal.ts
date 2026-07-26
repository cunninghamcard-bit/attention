/**
 * Input: ./Events
 * Output: unregisterEventRef
 * Pos: Core - Fundamental logic
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { EventRef } from "./Events";

interface RuntimeEventRef {
  e: {
    offref(ref: EventRef | null | undefined): void;
  };
}

export function unregisterEventRef(ref: EventRef | null | undefined): void {
  if (!ref) return;
  (ref as RuntimeEventRef).e.offref(ref);
}
