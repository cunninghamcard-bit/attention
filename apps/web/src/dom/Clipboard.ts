import { getActiveDocument, getActiveWindow } from "./ActiveDocument";

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
