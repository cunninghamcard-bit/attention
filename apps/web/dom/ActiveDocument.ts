/**
 * Input: None
 * Output: getActiveWindow, getActiveDocument, setActiveWindow, resetActiveWindow
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

let activeWindowRef: Window = window;
let activeDocumentRef: Document = document;

export function getActiveWindow(): Window {
  return activeWindowRef;
}

export function getActiveDocument(): Document {
  return activeDocumentRef;
}

export function setActiveWindow(win: Window): void {
  activeWindowRef = win;
  activeDocumentRef = win.document;
}

export function resetActiveWindow(): void {
  activeWindowRef = window;
  activeDocumentRef = document;
}
