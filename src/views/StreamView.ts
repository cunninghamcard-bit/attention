import { createDiv } from "../dom/dom";
import { ItemView } from "./ItemView";
import { StreamScroller } from "./StreamScroller";

// Our own tier in the view ladder (View -> ItemView -> StreamView), the way
// TextFileView is Obsidian's: a view whose content is a growing stream.
// It owns the two capabilities every streaming view needs and nothing else:
// a stick-to-bottom scroll region, and coalesced change scheduling.
// Not exported from the obsidian module — this is app vocabulary, not parity.
export abstract class StreamView extends ItemView {
  protected scrollEl: HTMLElement | null = null;
  protected scroller: StreamScroller | null = null;
  private syncScheduled = false;

  protected createStreamRegion(cls: string, parentEl: HTMLElement = this.contentEl): HTMLElement {
    this.scrollEl = createDiv(cls, parentEl);
    this.scroller = this.addChild(new StreamScroller(this.scrollEl, this.scrollEl));
    return this.scrollEl;
  }

  // One animation frame coalesces any number of change notifications into a
  // single onStreamSync pass. rAF never fires in background tabs, so a timer
  // races it — whichever lands first flushes, the other becomes a no-op.
  protected scheduleSync(): void {
    if (this.syncScheduled) return;
    this.syncScheduled = true;
    const flush = () => {
      if (!this.syncScheduled) return;
      this.syncScheduled = false;
      this.onStreamSync();
      this.scroller?.notifyContentChanged();
    };
    requestAnimationFrame(flush);
    window.setTimeout(flush, 50);
  }

  protected abstract onStreamSync(): void;
}
