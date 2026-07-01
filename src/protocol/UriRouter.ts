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
export type ObsidianProtocolDispatcher = (data: ObsidianProtocolData) => boolean | Promise<boolean>;

export class UriRouter {
  constructor(private readonly dispatch: ObsidianProtocolDispatcher = () => false) {}

  async handleUri(uri: string): Promise<boolean> {
    const data = parseObsidianUri(uri);
    if (!data) return false;
    return this.handleProtocolData(data);
  }

  async handleProtocolData(data: ObsidianProtocolData): Promise<boolean> {
    return Boolean(await this.dispatch(data));
  }
}

export function parseObsidianUri(uri: string): ObsidianProtocolData | null {
  if (uri.startsWith("obsidian://vault/")) {
    const [vault = "", ...file] = uri
      .slice("obsidian://vault/".length)
      .split("/")
      .map((part) => decodeURIComponent(part));
    return { action: "open", vault, file: file.join("/") };
  }

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
