export interface DesktopProtocolRequest {
  protocol: string;
  url: string;
  action: string;
  params: URLSearchParams;
}

export type DesktopProtocolCallback = (request: DesktopProtocolRequest) => void | Promise<void>;

export class DesktopProtocolHandler {
  private protocols = new Set<string>();
  private callbacks = new Map<string, DesktopProtocolCallback>();

  registerProtocol(protocol: string): void {
    this.protocols.add(protocol);
  }

  onAction(action: string, callback: DesktopProtocolCallback): void {
    this.callbacks.set(action, callback);
  }

  async handle(url: string): Promise<boolean> {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(/:$/, "");
    if (!this.protocols.has(protocol)) return false;
    const action = parsed.hostname || parsed.pathname.replace(/^\//, "");
    const callback = this.callbacks.get(action);
    if (!callback) return false;
    await callback({ protocol, url, action, params: parsed.searchParams });
    return true;
  }
}
