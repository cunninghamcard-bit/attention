import { session } from "electron";
import { APP_ORIGIN } from "./renderer-target";

/**
 * Default-session request/response header rewriting (reverse note "Header
 * rewriting on default session"). Pure so the rules are testable; wired to
 * webRequest in registerSessionHardening.
 */

export function rewriteRequestHeaders(
  url: string,
  headers: Record<string, string>,
): Record<string, string> {
  if (
    url.startsWith("https://www.youtube.com/embed/") ||
    url.startsWith("https://www.youtube-nocookie.com/embed/")
  ) {
    if (!headers.Referer) headers.Referer = "md.obsidian";
    return headers;
  }
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === "sec-fetch-dest" || lower === "sec-ch-ua") delete headers[key];
  }
  return headers;
}

export function rewriteResponseHeaders(
  headers: Record<string, string[]>,
  isSubframe: boolean,
): Record<string, string[]> {
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === "x-frame-options" || lower === "cross-origin-opener-policy") {
      delete headers[key];
    } else if (lower === "content-security-policy") {
      headers[key] = headers[key].map((v) => v.replace(/\s*frame-ancestors [^;]*(;|$)/g, ""));
    } else if (lower === "set-cookie" && isSubframe) {
      headers[key] = headers[key].map((v) =>
        /Secure;/i.test(v) ? v.replace(/SameSite=Lax/i, "SameSite=None") : v,
      );
    }
  }
  return headers;
}

const ALLOWED_PERMISSIONS = ["clipboard-read", "clipboard-sanitized-write"];

/** Real permission handler: app-origin allowed; clipboard from about:blank main
 * frame allowed; openExternal denied; fullscreen allowed. */
export function isPermissionAllowed(
  requestingUrl: string,
  permission: string,
  details: { isMainFrame?: boolean; requestingUrl?: string },
): boolean {
  let allowed = requestingUrl.startsWith(APP_ORIGIN);
  if (
    details.isMainFrame &&
    details.requestingUrl === "about:blank" &&
    permission.startsWith("clipboard-")
  ) {
    allowed = true;
  }
  if (permission === "openExternal") allowed = false;
  else if (permission === "fullscreen") allowed = true;
  else if (ALLOWED_PERMISSIONS.includes(permission)) allowed = true;
  return allowed;
}

export function registerSessionHardening(): void {
  const webRequest = session.defaultSession.webRequest;
  webRequest.onBeforeSendHeaders({ urls: ["https://*/*", "http://*/*"] }, (details, callback) => {
    callback({ requestHeaders: rewriteRequestHeaders(details.url, details.requestHeaders) });
  });
  webRequest.onHeadersReceived({ urls: ["https://*/*", "http://*/*"] }, (details, callback) => {
    const isSubframe = details.resourceType === "subFrame";
    callback({
      responseHeaders: rewriteResponseHeaders(
        (details.responseHeaders ?? {}) as Record<string, string[]>,
        isSubframe,
      ),
    });
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(isPermissionAllowed(wc.getURL(), permission, details));
  });
  // ponytail: skipped the reverse note's "tamper lock" (reassigning
  // session.webRequest/protocol mutators to no-ops). It's plugin-sandbox
  // hardening that fights modern Electron's API and adds no runnable value
  // here. Add if we ever load untrusted third-party plugins.
}
