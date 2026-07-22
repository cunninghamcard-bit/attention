import { describe, expect, it, vi } from "vitest";
import { unregisterEventRef } from "@web/core/EventRefInternal";
import { Events, type EventRef } from "@web/core/Events";

describe("Events", () => {
  it("returns opaque public event refs and triggers handlers with ctx", () => {
    const events = new Events();
    const ctx = { value: 0 };
    function handler(this: typeof ctx, amount: number): void {
      this.value += amount;
    }

    const ref: EventRef<[number]> = events.on("inc", handler, ctx);

    expect(typeof ref).toBe("object");

    events.trigger("inc", 2);

    expect(ctx.value).toBe(2);
  });

  it("matches Obsidian by preserving falsy listener contexts", () => {
    const events = new Events();
    let seen: unknown = "unset";
    function handler(this: unknown): void {
      // oxlint-disable-next-line typescript/no-this-alias -- The assertion intentionally captures the handler receiver.
      seen = this;
    }

    events.on("event", handler, 0);
    events.trigger("event");

    expect(seen).toBe(0);
  });

  it("removes handlers by original function, by event name, and by ref", () => {
    const events = new Events();
    const log: string[] = [];
    const first = () => log.push("first");
    const second = () => log.push("second");
    const firstRef = events.on("event", first);
    events.on("event", second);

    events.off("event", first);
    events.trigger("event");

    expect(log).toEqual(["second"]);

    events.offref(firstRef);
    events.off("event");
    events.trigger("event");

    expect(log).toEqual(["second"]);
  });

  it("stores listener refs under Obsidian's runtime _ table", () => {
    const events = new Events();
    const ref = events.on("event", () => {});
    const runtime = events as Events & { _: Record<string, EventRef[]> };

    expect(runtime._.event).toEqual([ref]);

    events.offref(ref);

    expect(runtime._.event).toBeUndefined();
  });

  it("matches Obsidian by ignoring missing event refs", () => {
    const events = new Events();

    expect(() => events.offref(null as unknown as EventRef)).not.toThrow();
    expect(() => events.offref(undefined as unknown as EventRef)).not.toThrow();
    expect(() => unregisterEventRef(null)).not.toThrow();
    expect(() => unregisterEventRef(undefined)).not.toThrow();
  });

  it("triggers a snapshot of listeners and rethrows listener errors asynchronously", () => {
    vi.useFakeTimers();
    try {
      const events = new Events();
      const thrown = new Error("boom");
      const log: string[] = [];
      const second = () => log.push("second");
      events.on("event", () => {
        log.push("first");
        events.off("event", second);
        throw thrown;
      });
      events.on("event", second);

      events.trigger("event");

      expect(log).toEqual(["first", "second"]);
      expect(() => vi.runOnlyPendingTimers()).toThrow(thrown);
    } finally {
      vi.useRealTimers();
    }
  });
});
