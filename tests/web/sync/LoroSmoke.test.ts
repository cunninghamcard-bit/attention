/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { describe, expect, it } from "vitest";
import { loadLoro } from "@web/sync/loro";

/**
 * The client replica layer stands on loro-crdt's WASM running under vitest.
 * This smoke test is the load-bearing assumption check: real docs, real
 * export/import, real movable tree — no mocks. If this file breaks, the
 * whole sync slice's test strategy needs rethinking, not patching.
 */

describe("loro-crdt under vitest", () => {
  it("round-trips text through export/import and subscribeLocalUpdates", async () => {
    const { LoroDoc } = await loadLoro();
    const a = new LoroDoc();
    const collected: Uint8Array[] = [];
    a.subscribeLocalUpdates((bytes) => collected.push(bytes));
    a.getText("content").insert(0, "hello");
    a.commit();
    expect(collected.length).toBeGreaterThan(0);

    const b = new LoroDoc();
    b.importBatch(collected);
    expect(b.getText("content").toString()).toBe("hello");

    // Idempotence — the property the whole transport design leans on.
    b.importBatch(collected);
    expect(b.getText("content").toString()).toBe("hello");
  });

  it("keeps tree node identity stable across a move", async () => {
    const { LoroDoc } = await loadLoro();
    const doc = new LoroDoc();
    const tree = doc.getTree("tree");
    const folder = tree.createNode();
    folder.data.set("name", "notes");
    const file = tree.createNode();
    file.data.set("name", "a.md");
    const id = file.id;
    tree.move(file.id, folder.id);
    doc.commit();
    expect(file.id).toBe(id);
    expect(tree.getNodeByID(id)?.parent()?.data.get("name")).toBe("notes");
  });
});
