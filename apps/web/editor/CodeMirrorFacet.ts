/**
 * Input: None
 * Output: Facet, Compartment
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

export class Facet<TInput, TOutput = readonly TInput[]> {
  constructor(
    readonly combine: (values: readonly TInput[]) => TOutput = (values) =>
      values as unknown as TOutput,
  ) {}
}

export class Compartment<T = unknown> {
  private extension: T | null = null;

  of(extension: T): this {
    this.extension = extension;
    return this;
  }

  reconfigure(extension: T): void {
    this.extension = extension;
  }

  get(): T | null {
    return this.extension;
  }
}
