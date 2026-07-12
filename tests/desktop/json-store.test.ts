import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonStore } from "@desktop/json-store";

let dir: string;
let store: JsonStore;

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "json-store-"));
  store = new JsonStore(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("JsonStore", () => {
  it("round-trips a named JSON document (real ne/G)", () => {
    store.write("obsidian", { vaults: {}, frame: "native" });
    expect(store.read("obsidian", {})).toEqual({ vaults: {}, frame: "native" });
    expect(fs.existsSync(join(dir, "obsidian.json"))).toBe(true);
  });

  it("returns the fallback when the file is missing or corrupt", () => {
    expect(store.read("missing", { a: 1 })).toEqual({ a: 1 });
    fs.writeFileSync(join(dir, "broken.json"), "{not json");
    expect(store.read("broken", {})).toEqual({});
  });

  it("never throws on write/remove failures (best-effort like real ae())", () => {
    const readonly = new JsonStore("/dev/null/nope");
    expect(() => readonly.write("x", {})).not.toThrow();
    expect(() => readonly.remove("x")).not.toThrow();
    expect(() => store.remove("never-existed")).not.toThrow();
  });

  it("removes per-vault state files (real re)", () => {
    store.write("abc123", { x: 1, y: 2 });
    store.remove("abc123");
    expect(fs.existsSync(join(dir, "abc123.json"))).toBe(false);
  });
});
