import { describe, expect, it } from "vitest";
import { Typewriter } from "@web/views/Typewriter";

function collect() {
  const calls: Array<{ visible: string; done: boolean }> = [];
  const tw = new Typewriter((visible, done) => calls.push({ visible, done }));
  return { tw, calls };
}

describe("Typewriter", () => {
  it("reveals a prefix per tick and drains the backlog", () => {
    const { tw, calls } = collect();
    tw.setTarget("a".repeat(1000), false);
    tw.destroy(); // drive time by hand, not rAF
    let now = 0;
    while ((calls[calls.length - 1]?.visible.length ?? 0) < 1000 && now < 10_000) {
      tw.tick((now += 16));
    }
    const lengths = calls.map((call) => call.visible.length);
    expect(lengths[0]).toBeGreaterThan(0);
    expect(lengths[0]).toBeLessThan(1000); // not all at once
    expect(lengths[lengths.length - 1]).toBe(1000); // fully drained
    expect(now).toBeLessThan(2000); // exponential drain converges fast
    for (let index = 1; index < lengths.length; index++)
      expect(lengths[index]).toBeGreaterThan(lengths[index - 1]);
  });

  it("final target flushes immediately and reports done", () => {
    const { tw, calls } = collect();
    tw.setTarget("hello ", false);
    tw.setTarget("hello world", true);
    const last = calls[calls.length - 1];
    expect(last.visible).toBe("hello world");
    expect(last.done).toBe(true);
  });

  it("keeps pace with a slow stream instead of racing ahead", () => {
    const { tw, calls } = collect();
    tw.setTarget("abc", false);
    tw.destroy();
    tw.tick(16);
    tw.tick(32);
    tw.tick(48);
    // 3 chars behind -> snap threshold clears the whole backlog quickly
    expect(calls[calls.length - 1].visible).toBe("abc");
    expect(calls.every((call) => !call.done)).toBe(true);
  });
});
