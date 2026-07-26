/**
 * Input: None
 * Output: Tasks, QuitEvent
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

export class Tasks {
  private readonly promises: Array<Promise<unknown>> = [];

  add(fn: () => unknown | PromiseLike<unknown>): void {
    this.addPromise(Promise.resolve().then(fn));
  }

  addPromise(promise: unknown | PromiseLike<unknown>): void {
    this.promises.push(Promise.resolve(promise));
  }

  isEmpty(): boolean {
    return this.promises.length === 0;
  }

  promise(): Promise<unknown[]> {
    return Promise.all(this.promises);
  }
}

export class QuitEvent extends Tasks {}
