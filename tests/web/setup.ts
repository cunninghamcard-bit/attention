import { beforeEach } from "vitest";

// jsdom has no ResizeObserver and every real runtime does. Anything hosting
// pierre's CodeView needs one, which is why three GitHub suites had each grown
// their own copy of this stub; the file preview would have made a fourth, so it
// lives here once instead. Those copies are guarded on `typeof` and simply stop
// being reached; removing them is a separate change.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

function installAnimationFrame(target: Window): void {
  if (!target.requestAnimationFrame) {
    Object.defineProperty(target, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) =>
        setTimeout(() => callback(Date.now()), 0) as unknown as number,
    });
  }
  if (!target.cancelAnimationFrame) {
    Object.defineProperty(target, "cancelAnimationFrame", {
      configurable: true,
      value: (handle: number) => clearTimeout(handle),
    });
  }
}

beforeEach(() => installAnimationFrame(window));

// Environment teardown deletes the injected own-properties while CodeMirror
// measure timers may still be pending; a prototype-level fallback keeps late
// timers from crashing the run (`this.win.requestAnimationFrame is not a
// function` flake).
const windowPrototype = Object.getPrototypeOf(window) as Window;
if (windowPrototype && !Object.getOwnPropertyDescriptor(windowPrototype, "requestAnimationFrame")) {
  try {
    installAnimationFrame(windowPrototype);
  } catch {
    // prototype may be frozen in some environments; the flake stays rare
  }
}
