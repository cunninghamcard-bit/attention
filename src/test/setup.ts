import { beforeEach } from "vitest";

function installAnimationFrame(target: Window): void {
  if (!target.requestAnimationFrame) {
    Object.defineProperty(target, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => target.setTimeout(() => callback(target.performance.now()), 0),
    });
  }
  if (!target.cancelAnimationFrame) {
    Object.defineProperty(target, "cancelAnimationFrame", {
      configurable: true,
      value: (handle: number) => target.clearTimeout(handle),
    });
  }
}

beforeEach(() => installAnimationFrame(window));
