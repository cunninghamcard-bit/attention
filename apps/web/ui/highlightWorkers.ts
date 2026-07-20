import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from "@pierre/diffs/worker";

/** Shiki highlighting runs in pierre's worker pool (codiff's recipe: 3
 * workers, same limits) so big diffs never block the main thread. Absent in
 * jsdom, where Worker does not exist — CodeView then highlights inline, which
 * is why callers pass the result through rather than requiring it. */
export function highlightWorkers(): WorkerPoolManager | undefined {
  if (typeof Worker === "undefined") return undefined;
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      poolSize: Math.min(3, Math.max(1, navigator.hardwareConcurrency || 3)),
      workerFactory: () =>
        new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
          type: "module",
        }),
    },
    highlighterOptions: { maxLineDiffLength: 2000, tokenizeMaxLineLength: 20_000 },
  });
}
