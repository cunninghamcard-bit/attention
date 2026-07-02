import { protocol } from "electron";
import { createReadStream, promises as fsp } from "node:fs";
import { Readable } from "node:stream";
import {
  computeContentRange,
  resolveAppUrl,
  type ResolveDeps,
} from "./app-protocol";

/**
 * Register the `app://` scheme handler on the default session (real
 * `protocol.handle("app", ...)` inside `whenReady`).
 *
 * Streams the resolved file with `Content-Length`, `Last-Modified`,
 * `Access-Control-Allow-Origin: *`, `X-Frame-Options: DENY` for framed/remote
 * responses, and full HTTP Range support (206/416). A `""` resolution → 400.
 */
export function registerAppProtocol(deps: ResolveDeps): void {
  protocol.handle("app", async (request) => {
    const { path, noframe } = resolveAppUrl(request.url, deps);
    if (!path) return new Response("Not Found", { status: 400 });
    try {
      const stat = await fsp.stat(path);
      const range = computeContentRange(request.headers.get("Range"), stat.size);
      if (range.status === 416) {
        return new Response("Range Not Satisfiable", { status: 416 });
      }
      const headers = new Headers(range.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Last-Modified", stat.mtime.toUTCString());
      if (noframe) headers.set("X-Frame-Options", "DENY");
      const nodeStream =
        range.status === 206
          ? createReadStream(path, { start: range.start, end: range.end })
          : createReadStream(path);
      const body = Readable.toWeb(nodeStream) as ReadableStream;
      return new Response(body, { status: range.status, headers });
    } catch {
      return new Response("Not Found", { status: 400 });
    }
  });
}

/**
 * Real: registered as a *privileged* scheme so the renderer running from
 * `app://obsidian.md/` behaves like a secure context (fetch, workers, etc.).
 * Must be called before `app.ready`.
 */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: true,
      },
    },
  ]);
}
