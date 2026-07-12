import { unregisterEventRef } from "../core/EventRefInternal";
import type { MetadataCache } from "../metadata/MetadataCache";
import { Notice } from "../ui/Notice";

// User-facing indexing notices for the (headless) metadata cache. The cache
// emits progress via events/getters; the Notice display lives here, app-side,
// so the kernel never imports the UI.

// Shows a per-file Notice when metadata indexing for a file runs long. Install
// once before initial indexing so slow-file events aren't missed.
export function installSlowIndexingNotice(cache: MetadataCache): void {
  cache.on("indexing-slow", (path: string) => {
    new Notice(`Indexing taking a long time for ${path}`);
  });
}

// Progress notice for a bulk (re)index: appears after 1s if still indexing,
// updates on each change/finish, and switches to "Indexing complete" once the
// cache is clean. Moved verbatim from MetadataCache.showIndexingNotice.
export function showIndexingNotice(cache: MetadataCache): void {
  let indexingNotice: Notice | null = null;
  setTimeout(() => {
    if (cache.pendingTaskCount === 0) return;
    const total = cache.cachedMetadataCount + cache.pendingTaskCount;
    if (total === 0) return;
    const notice = new Notice(formatIndexingNotice(total, cache.pendingTaskCount), 0);
    indexingNotice = notice;
    const update = () => notice.setMessage(formatIndexingNotice(total, cache.pendingTaskCount));
    const changedRef = cache.on("changed", update);
    const finishedRef = cache.on("finished", update);
    cache.onCleanCache(() => {
      unregisterEventRef(changedRef);
      unregisterEventRef(finishedRef);
      if (indexingNotice !== notice) return;
      notice.setMessage("Indexing complete");
      setTimeout(() => {
        if (indexingNotice === notice) {
          notice.hide();
          indexingNotice = null;
        }
      }, 3000);
    });
  }, 1000);
}

function formatIndexingNotice(total: number, inProgress: number): string {
  const complete = Math.max(0, Math.min(total, total - inProgress));
  return `Indexing ${complete}/${total}`;
}
