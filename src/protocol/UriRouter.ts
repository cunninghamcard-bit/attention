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
  const prefix = "obsidian://";
  if (!uri.startsWith(prefix)) return null;
  if (uri.startsWith("obsidian://vault/")) {
    const [vault = "", ...file] = uri
      .slice("obsidian://vault/".length)
      .split("/")
      .map((part) => decodeURIComponent(part));
    return { action: "open", vault, file: file.join("/") };
  }

  const data: ObsidianProtocolData = { action: "" };
  let body = uri.slice(prefix.length);
  const queryIndex = body.indexOf("?");
  const hashIndex = body.indexOf("#", Math.max(0, queryIndex));
  let query = "";
  if (hashIndex >= 0) {
    data.hash = body.slice(hashIndex + 1);
    body = body.slice(0, hashIndex);
  }
  if (queryIndex >= 0) {
    query = body.slice(queryIndex + 1);
    body = body.slice(0, queryIndex);
  }
  for (const part of query.split("&")) {
    const [key, value] = part.split("=");
    data[decodeURIComponent(key ?? "")] = value === undefined ? "true" : decodeURIComponent(value);
  }
  data.action = body.replace(/\/+$/g, "");
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
