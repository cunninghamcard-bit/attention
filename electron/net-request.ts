import { net } from "electron";
import type { RequestUrlParams, RequestUrlResult } from "./ipc";

/**
 * `request-url` transport — real `s.net.request(...)` with redirect:"follow",
 * header passthrough, and the body returned as an ArrayBuffer. Runs in the
 * main process so requests bypass renderer CORS, exactly like real Obsidian.
 */
export function performNetRequest(params: RequestUrlParams): Promise<RequestUrlResult> {
  return new Promise<RequestUrlResult>((resolvePromise) => {
    try {
      const request = net.request({
        url: params.url,
        method: params.method || "GET",
        redirect: "follow",
      });
      if (params.contentType) request.setHeader("Content-Type", params.contentType);
      if (params.headers) {
        for (const key of Object.keys(params.headers)) {
          try {
            request.setHeader(key, params.headers[key]);
          } catch {
            // Skip headers Electron refuses to set (matches real try/catch).
          }
        }
      }
      request.on("login", (_authInfo, callback) => callback());
      request.on("error", (error) => resolvePromise({ error }));
      request.on("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolvePromise({
            status: response.statusCode,
            headers: response.headers as Record<string, unknown>,
            body: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          });
        });
      });
      if (typeof params.body === "string") request.write(params.body);
      else if (params.body instanceof ArrayBuffer) {
        request.write(Buffer.from(new Uint8Array(params.body)));
      }
      request.end();
    } catch (error) {
      resolvePromise({ error });
    }
  });
}
