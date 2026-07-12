import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const DEFAULT_PASTE_CARD_THRESHOLD = 20;

export function getPasteCardThreshold(): number {
  try {
    const stored = Number(window.localStorage?.getItem("chat-paste-threshold"));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_PASTE_CARD_THRESHOLD;
}

export type PasteTriage =
  | { kind: "card"; text: string }
  | { kind: "inline"; text: string };

// Paste triage: long pastes become cards instead of flooding the draft;
// short pastes with runs of blank lines are collapsed before inline insert.
export function triagePastedText(text: string, thresholdLines = DEFAULT_PASTE_CARD_THRESHOLD): PasteTriage {
  const lineCount = text.split("\n").length;
  if (lineCount >= thresholdLines) return { kind: "card", text };
  return { kind: "inline", text: text.replace(/\n{2,}/g, "\n") };
}

export interface ComposerPasteHandlers {
  addTextAttachment(name: string, content: string): void;
  addFileAttachment(file: File): void;
}

function insertInline(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
}

function takeFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files: File[] = [];
  for (const item of transfer.items ?? []) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length === 0) for (const file of transfer.files ?? []) files.push(file);
  return files;
}

export function composerPasteExtension(handlers: ComposerPasteHandlers): Extension {
  let pastedCardCount = 0;
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const transfer = event.clipboardData;
      const files = takeFiles(transfer);
      if (files.length > 0) {
        event.preventDefault();
        for (const file of files) handlers.addFileAttachment(file);
        return true;
      }
      const text = transfer?.getData("text/plain") ?? "";
      if (!text) return false;
      const triage = triagePastedText(text, getPasteCardThreshold());
      event.preventDefault();
      if (triage.kind === "card") {
        handlers.addTextAttachment(`Pasted text ${++pastedCardCount > 1 ? pastedCardCount : ""}`.trim(), triage.text);
      } else {
        insertInline(view, triage.text);
      }
      return true;
    },
    drop: (event) => {
      const files = takeFiles(event.dataTransfer);
      if (files.length === 0) return false;
      event.preventDefault();
      for (const file of files) handlers.addFileAttachment(file);
      return true;
    },
  });
}
