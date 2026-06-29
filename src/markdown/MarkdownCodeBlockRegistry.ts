import type { MarkdownCodeBlockProcessor, MarkdownPostProcessorContext } from "./MarkdownRenderer";

export class MarkdownCodeBlockRegistry {
  private processors = new Map<string, MarkdownCodeBlockProcessor>();

  register(language: string, processor: MarkdownCodeBlockProcessor): void {
    if (this.processors.has(language)) throw new Error(`Code block postprocessor for language ${language} is already registered`);
    this.processors.set(language, processor);
  }

  unregister(language: string): void {
    this.processors.delete(language);
  }

  async render(language: string, source: string, el: HTMLElement, context: MarkdownPostProcessorContext): Promise<boolean> {
    const processor = this.processors.get(language);
    if (!processor) return false;
    await processor(source, el, context);
    return true;
  }

  clear(): void {
    this.processors.clear();
  }
}
