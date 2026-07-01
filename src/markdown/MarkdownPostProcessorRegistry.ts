import type { MarkdownPostProcessor, MarkdownPostProcessorContext } from "./MarkdownRenderer";

export interface OrderedMarkdownPostProcessor {
  sortOrder: number;
  processor: MarkdownPostProcessor;
}

type MarkdownPostProcessorRunContext = MarkdownPostProcessorContext & {
  promises: Promise<void>[];
};

export class MarkdownPostProcessorRegistry {
  private processors: OrderedMarkdownPostProcessor[] = [];

  register(processor: MarkdownPostProcessor, sortOrder = processor.sortOrder ?? 0): void {
    processor.sortOrder = sortOrder;
    this.processors.push({ processor, sortOrder });
    this.processors.sort((a, b) => (a.processor.sortOrder ?? 0) - (b.processor.sortOrder ?? 0));
  }

  unregister(processor: MarkdownPostProcessor): void {
    const index = this.processors.findIndex((item) => item.processor === processor);
    if (index !== -1) this.processors.splice(index, 1);
  }

  run(element: HTMLElement, context: MarkdownPostProcessorRunContext): void {
    for (const item of this.processors) {
      const result = item.processor(element, context);
      if (result && typeof result.then === "function") context.promises.push(result);
    }
  }

  clear(): void {
    this.processors = [];
  }
}
