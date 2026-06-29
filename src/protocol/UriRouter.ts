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
    const data = parseObsidianUri(uri);
    if (!data) return false;
    return this.handleProtocolData(data);
  }

  async handleProtocolData(data: ObsidianProtocolData): Promise<boolean> {
    const action = data.action;
    const handler = this.handlers.get(action);
    if (!handler) return false;
    await handler(createUriHandlerContextFromData(data));
    return true;
  }
}

export function parseObsidianUri(uri: string): ObsidianProtocolData | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  const action = url.hostname || url.pathname.replace(/^\//, "");
  if (!action) return null;
  return createProtocolData(action, url.searchParams);
}

function createUriHandlerContext(action: string, params: URLSearchParams): UriHandlerContext {
  const context: UriHandlerContext = { action, params };
  for (const [key, value] of params.entries()) context[key] = value === "" ? "true" : value;
  return context;
}

function createUriHandlerContextFromData(data: ObsidianProtocolData): UriHandlerContext {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (key === "action") continue;
    params.set(key, value === "true" ? "" : value);
  }
  const context = createUriHandlerContext(data.action, params);
  for (const [key, value] of Object.entries(data)) {
    if (key !== "action") context[key] = value;
  }
  return context;
}

function createProtocolData(action: string, params: URLSearchParams): ObsidianProtocolData {
  const data: ObsidianProtocolData = { action };
  for (const [key, value] of params.entries()) data[key] = value === "" ? "true" : value;
  return data;
}

export function toObsidianProtocolData(context: UriHandlerContext): ObsidianProtocolData {
  const data: ObsidianProtocolData = { action: context.action };
  for (const [key, value] of Object.entries(context)) {
    if (key === "params") continue;
    if (typeof value === "string") data[key] = value as string | "true";
  }
  return data;
}
