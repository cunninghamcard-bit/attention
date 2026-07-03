// Adaptive typewriter for streaming text, part of the stream family: the
// producer keeps feeding the full target buffer, the typewriter reveals a
// growing prefix at a rate that drains the backlog exponentially (~dt/DRAIN_MS
// of what's left per frame). Slow streams read at their natural pace, bursts
// catch up smoothly instead of lagging, and a final target snaps immediately.
// Content-agnostic: it only hands back string prefixes.

const DRAIN_MS = 250;
// Nearly caught up -> snap, so the tail never crawls one char at a time.
const SNAP_THRESHOLD = 2;

export class Typewriter {
  private target = "";
  private final = false;
  private visible = 0;
  private lastTick = 0;
  private scheduled = false;
  private raf = 0;
  private timer = 0;

  constructor(private readonly onReveal: (visible: string, done: boolean) => void) {}

  setTarget(text: string, final: boolean): void {
    this.target = text;
    this.final = final;
    if (final) {
      this.cancel();
      this.visible = text.length;
      this.onReveal(text, true);
      return;
    }
    this.schedule();
  }

  // One pacing step; public so tests drive time by hand instead of rAF.
  tick(now: number): void {
    const dt = this.lastTick ? Math.min(100, now - this.lastTick) : 16;
    this.lastTick = now;
    const behind = this.target.length - this.visible;
    if (behind <= 0) return;
    const step = Math.max(1, Math.ceil(behind * (dt / DRAIN_MS)));
    this.visible = behind - step <= SNAP_THRESHOLD ? this.target.length : this.visible + step;
    this.onReveal(this.target.slice(0, this.visible), this.final && this.visible >= this.target.length);
  }

  destroy(): void {
    this.cancel();
  }

  // rAF paced, with a timer racing it so background tabs (no rAF) still
  // drain — the same race StreamView.scheduleSync uses.
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const fire = () => {
      if (!this.scheduled) return;
      this.scheduled = false;
      cancelAnimationFrame(this.raf);
      window.clearTimeout(this.timer);
      this.tick(Date.now());
      if (this.visible < this.target.length) this.schedule();
    };
    this.raf = requestAnimationFrame(fire);
    this.timer = window.setTimeout(fire, 50);
  }

  private cancel(): void {
    this.scheduled = false;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.timer);
  }
}
