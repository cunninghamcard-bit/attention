export interface NativeBridgeRequest<T = unknown> {
  channel: string;
  payload?: T;
}

export type NativeBridgeHandler<T = unknown, R = unknown> = (payload: T) => R | Promise<R>;

export class NativeBridge {
  private handlers = new Map<string, NativeBridgeHandler>();

  handle<T, R>(channel: string, handler: NativeBridgeHandler<T, R>): void {
    this.handlers.set(channel, handler as NativeBridgeHandler);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  hasHandler(channel: string): boolean {
    return this.handlers.has(channel);
  }

  async invoke<T = unknown, R = unknown>(request: NativeBridgeRequest<T>): Promise<R> {
    const handler = this.handlers.get(request.channel);
    if (!handler) throw new Error(`No native handler registered for ${request.channel}`);
    return handler(request.payload) as Promise<R>;
  }
}
