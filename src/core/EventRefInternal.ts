import type { EventRef } from "./Events";

interface RuntimeEventRef {
  e: {
    offref(ref: EventRef): void;
  };
}

export function unregisterEventRef(ref: EventRef): void {
  (ref as RuntimeEventRef).e.offref(ref);
}
