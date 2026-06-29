export interface ObsidianProtocolData {
  action: string;
  [key: string]: string | "true";
}

export type ObsidianProtocolHandler = (params: ObsidianProtocolData) => any;

export interface UriHandlerContext {
  action: string;
  [key: string]: string | "true" | URLSearchParams;
  params: URLSearchParams;
}

export type UriHandler = (context: UriHandlerContext) => void | Promise<void>;

export class UriRouter {
  private handlers = new Map<string, UriHandler>();

  registerAction(action: string, handler: UriHandler): void {
    if (this.handlers.has(action)) throw new Error(`Action "${action}" is already registered as a handler.`);
    this.handlers.set(action, handler);
  }

  unregisterAction(action: string, handler?: UriHandler): void {
    if (handler && this.handlers.get(action) !== handler) return;
    this.handlers.delete(action);
  }

  async handleUri(uri: string): Promise<boolean> {
    const url = new URL(uri);
    const action = url.hostname || url.pathname.replace(/^\//, "");
    const handler = this.handlers.get(action);
    if (!handler) return false;
    await handler(createUriHandlerContext(action, url.searchParams));
    return true;
  }
}

function createUriHandlerContext(action: string, params: URLSearchParams): UriHandlerContext {
  const context: UriHandlerContext = { action, params };
  for (const [key, value] of params.entries()) context[key] = value === "" ? "true" : value;
  return context;
}

export function toObsidianProtocolData(context: UriHandlerContext): ObsidianProtocolData {
  const data: ObsidianProtocolData = { action: context.action };
  for (const [key, value] of Object.entries(context)) {
    if (key === "params") continue;
    if (typeof value === "string") data[key] = value as string | "true";
  }
  return data;
}
