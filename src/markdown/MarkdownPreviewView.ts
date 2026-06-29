import type { MarkdownView } from "../views/MarkdownView";
import { MarkdownPreviewSection } from "./MarkdownPreviewSection";

export class MarkdownPreviewView {
  sections: MarkdownPreviewSection[] = [];

  constructor(readonly owner: MarkdownView) {}

  clear(): void {
    this.sections = [];
  }
}
