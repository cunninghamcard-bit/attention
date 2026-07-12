import "../../styles/index.css";
import { applyObsidianBodyClasses, installFocusBodyClassSync } from "../BodyClasses";
import { FrameDom } from "../FrameDom";
import { StarterScreen, type StarterIpc } from "./StarterScreen";

declare global {
  interface ImportMeta {
    env: { DEV: boolean };
  }
}

/**
 * Starter (vault chooser) entry — the standalone page main loads into the
 * 800x650 starter window. Boot order mirrors the real starter bundle:
 * frame/titlebar first, platform body classes, focus class, then the screen.
 */

function resolveIpc(): StarterIpc {
  const bridge = (window as Window & {
    electron?: { ipcRenderer?: StarterIpc };
  }).electron?.ipcRenderer;
  if (bridge?.sendSync) return bridge;
  if (import.meta.env.DEV) {
    // Browser-pane preview only: an in-memory registry so the page can be
    // exercised without Electron. Dev-only and loud — never a product path.
    console.warn("[starter] no electron bridge — using an in-memory dev registry");
    return createDevFakeIpc();
  }
  throw new Error("The starter page requires the desktop app's electron bridge.");
}

function createDevFakeIpc(): StarterIpc {
  const vaults: Record<string, { path: string; ts: number; open?: boolean }> = {
    dev1: { path: "/Users/dev/Vaults/workbench-demo-vault", ts: 3, open: true },
    dev2: { path: "/Users/dev/Vaults/work-notes", ts: 2 },
    dev3: { path: "/Users/dev/Documents/research", ts: 1 },
  };
  return {
    sendSync(channel: string, ...args: unknown[]): unknown {
      switch (channel) {
        case "version": return "0.0.0-dev";
        case "vault-list": return vaults;
        case "get-default-vault-path": return "/Users/dev/Documents/Workbench Vault";
        case "vault-open": return true;
        case "vault-move": {
          const [from, to] = args as [string, string];
          for (const entry of Object.values(vaults)) {
            if (entry.path === from) entry.path = to;
          }
          return "";
        }
        case "vault-remove": {
          const [path] = args as [string];
          for (const id of Object.keys(vaults)) {
            if (vaults[id].path === path) {
              if (vaults[id].open) return false;
              delete vaults[id];
              return true;
            }
          }
          return false;
        }
        default: return undefined;
      }
    },
    invoke: async () => ["/Users/dev/picked-folder"],
  };
}

new FrameDom(document, { hidden: true });
applyObsidianBodyClasses(document.body);
installFocusBodyClassSync();
document.body.classList.add("is-focused");
new StarterScreen(document.body, resolveIpc());
