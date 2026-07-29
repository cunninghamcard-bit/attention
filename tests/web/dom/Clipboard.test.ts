/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardImage } from "@web/dom/Clipboard";

/**
 * "Copy image" puts the pixels on the clipboard, not a link. The clipboard is
 * typed, so bytes have to be decoded into a platform image first: Electron's
 * `nativeImage` when it is there (what real Obsidian uses), otherwise the web's
 * async clipboard, which in practice takes `image/png` and little else.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

interface ElectronStub {
  writeImage: ReturnType<typeof vi.fn>;
  createFromBuffer: ReturnType<typeof vi.fn>;
}

function installElectron(empty = false): ElectronStub {
  const writeImage = vi.fn();
  const createFromBuffer = vi.fn(() => ({ isEmpty: () => empty }));
  (window as unknown as { electron: unknown }).electron = {
    remote: { nativeImage: { createFromBuffer }, clipboard: { writeImage } },
  };
  return { writeImage, createFromBuffer };
}

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron;
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(window, "ClipboardItem");
});

describe("writeClipboardImage", () => {
  it("decodes through nativeImage and writes it, on the desktop path", async () => {
    const { writeImage, createFromBuffer } = installElectron();

    await expect(writeClipboardImage(PNG, "image/png")).resolves.toBe(true);

    expect(createFromBuffer).toHaveBeenCalledTimes(1);
    // A Uint8Array view, not the raw ArrayBuffer — nativeImage takes a buffer.
    expect(createFromBuffer.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(writeImage).toHaveBeenCalledTimes(1);
  });

  it("reports failure rather than writing an image nativeImage could not decode", async () => {
    const { writeImage } = installElectron(true);

    await expect(writeClipboardImage(PNG, "image/png")).resolves.toBe(false);

    expect(writeImage).not.toHaveBeenCalled();
  });

  it("falls back to the async clipboard when there is no Electron", async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    Object.defineProperty(window, "ClipboardItem", {
      value: class {
        constructor(readonly items: Record<string, Blob>) {}
      },
      configurable: true,
    });

    await expect(writeClipboardImage(PNG, "image/png")).resolves.toBe(true);

    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as unknown as { items: Record<string, Blob> };
    expect(Object.keys(item.items)).toEqual(["image/png"]);
  });

  it("reports failure when neither clipboard route exists", async () => {
    await expect(writeClipboardImage(PNG, "image/png")).resolves.toBe(false);
  });
});
