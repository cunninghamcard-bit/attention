import type { MarkdownCodeBlockProcessor } from "./MarkdownRenderer";

export class MarkdownCodeBlockRegistry {
  private processors = new Map<string, MarkdownCodeBlockProcessor>();

  register(language: string, processor: MarkdownCodeBlockProcessor): void {
    if (this.processors.has(language))
      throw new Error(`Code block postprocessor for language ${language} is already registered`);
    this.processors.set(language, processor);
  }

  unregister(language: string): void {
    this.processors.delete(language);
  }

  clear(): void {
    this.processors.clear();
  }
}
