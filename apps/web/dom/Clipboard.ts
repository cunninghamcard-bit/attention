/**
 * Input: ./ActiveDocument
 * Output: readClipboardText, writeClipboardText, writeClipboardImage
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { getActiveDocument, getActiveWindow } from "./ActiveDocument";

interface ElectronClipboardHost {
  electron?: {
    remote?: {
      nativeImage?: { createFromBuffer(buffer: Uint8Array): NativeImageHandle };
      clipboard?: { writeImage(image: NativeImageHandle): void };
    };
  };
}

/** Opaque to us — only Electron's own clipboard consumes it. */
interface NativeImageHandle {
  isEmpty(): boolean;
}

export async function readClipboardText(): Promise<string> {
  return (await getActiveClipboard()?.readText?.()) ?? "";
}

export async function writeClipboardText(text: string): Promise<void> {
  const clipboard = getActiveClipboard();
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return;
  }
  copyTextFallback(text);
}

/**
 * Puts an image on the system clipboard — the pixels, not a link, so it pastes
 * into anything that takes a picture.
 *
 * The clipboard is typed, so bytes cannot go in as bytes: they have to be
 * decoded into whatever the platform calls an image first. Electron's
 * `nativeImage` does that for any format Chromium can decode, which is the path
 * real Obsidian takes (`nativeImage.createFromBuffer` → `clipboard.writeImage`).
 * The web's async clipboard is the fallback and a narrower one — it takes
 * `image/png` and little else — so a JPEG only survives it by being re-encoded,
 * which is what the canvas round-trip below does.
 */
export async function writeClipboardImage(bytes: ArrayBuffer, mimeType: string): Promise<boolean> {
  const remote = (getActiveWindow() as unknown as ElectronClipboardHost).electron?.remote;
  const nativeImage = remote?.nativeImage;
  const electronClipboard = remote?.clipboard;
  if (nativeImage && electronClipboard) {
    const image = nativeImage.createFromBuffer(new Uint8Array(bytes));
    if (!image.isEmpty()) {
      electronClipboard.writeImage(image);
      return true;
    }
    return false;
  }
  const clipboard = getActiveClipboard();
  const ClipboardItemCtor = (getActiveWindow() as Window & { ClipboardItem?: typeof ClipboardItem })
    .ClipboardItem;
  if (!clipboard?.write || !ClipboardItemCtor) return false;
  try {
    const png = await toPngBlob(new Blob([bytes], { type: mimeType }), mimeType);
    if (!png) return false;
    await clipboard.write([new ClipboardItemCtor({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}

/** PNG passes through; anything else is re-encoded, since that is the only
 * type the async clipboard reliably accepts. */
async function toPngBlob(blob: Blob, mimeType: string): Promise<Blob | null> {
  if (mimeType === "image/png") return blob;
  const win = getActiveWindow();
  if (!win.createImageBitmap || !getActiveDocument().createElement("canvas").getContext)
    return null;
  const bitmap = await win.createImageBitmap(blob);
  const canvas = getActiveDocument().createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function getActiveClipboard(): Clipboard | undefined {
  return getActiveWindow().navigator.clipboard ?? navigator.clipboard;
}

function copyTextFallback(text: string): void {
  const activeDocument = getActiveDocument();
  const textarea = activeDocument.createElement("textarea");
  textarea.value = text;
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.position = "fixed";
  activeDocument.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    activeDocument.execCommand("copy");
  } catch {
    // Obsidian swallows copy fallback errors here.
  }
  textarea.remove();
}
