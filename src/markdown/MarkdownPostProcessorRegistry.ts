import type { MarkdownPostProcessor, MarkdownPostProcessorContext } from "./MarkdownRenderer";

export interface OrderedMarkdownPostProcessor {
  sortOrder: number;
  processor: MarkdownPostProcessor;
}

export class MarkdownPostProcessorRegistry {
  private processors: OrderedMarkdownPostProcessor[] = [];

  register(processor: MarkdownPostProcessor, sortOrder = processor.sortOrder ?? 0): void {
    processor.sortOrder = sortOrder;
    this.processors.push({ processor, sortOrder });
    this.processors.sort((a, b) => (a.processor.sortOrder ?? 0) - (b.processor.sortOrder ?? 0));
  }

  unregister(processor: MarkdownPostProcessor): void {
    this.processors = this.processors.filter((item) => item.processor !== processor);
  }

  async run(element: HTMLElement, context: MarkdownPostProcessorContext): Promise<void> {
    for (const item of this.processors) await item.processor(element, context);
  }

  clear(): void {
    this.processors = [];
  }
}
