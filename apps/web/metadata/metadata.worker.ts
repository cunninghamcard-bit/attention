/**
 * Input: ./MarkdownMetadataParser
 * Output: (worker entry — no exports)
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { parseMarkdownMetadata } from "./MarkdownMetadataParser";

/**
 * The metadata worker: receives a markdown file's ArrayBuffer, replies with
 * its CachedMetadata. Real Obsidian indexes in a worker exactly like this —
 * MetadataCache's onReceiveMessageFromWorker is the receiving half. One
 * message in flight at a time (the cache's work queue is serial).
 */
self.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
  const source = new TextDecoder().decode(event.data);
  (self as unknown as { postMessage(value: unknown): void }).postMessage(
    parseMarkdownMetadata(source),
  );
});
