import * as codemirrorAutocomplete from "@codemirror/autocomplete";
import * as codemirrorCollab from "@codemirror/collab";
import * as codemirrorCommands from "@codemirror/commands";
import * as codemirrorLanguage from "@codemirror/language";
import * as codemirrorLint from "@codemirror/lint";
import * as codemirrorSearch from "@codemirror/search";
import * as codemirrorState from "@codemirror/state";
import * as codemirrorView from "@codemirror/view";
import * as lezerCommon from "@lezer/common";
import * as lezerHighlight from "@lezer/highlight";
import * as lezerLr from "@lezer/lr";
import type { App } from "../app/App";
import { createObsidianPluginModule } from "../api/ObsidianPluginModule";
import { Notice } from "../ui/Notice";

export type PluginRequire = (id: string) => unknown;

const DEPRECATED_CODEMIRROR_MESSAGE =
  "See the stack trace to find the faulty plugin and file an issue with the plugin author.\nDetails: https://discuss.codemirror.net/t/release-0-20-0/4302";

const CODEMIRROR_MODULES: Record<string, unknown> = {
  "@codemirror/autocomplete": codemirrorAutocomplete,
  "@codemirror/collab": codemirrorCollab,
  "@codemirror/commands": codemirrorCommands,
  "@codemirror/language": codemirrorLanguage,
  "@codemirror/lint": codemirrorLint,
  "@codemirror/search": codemirrorSearch,
  "@codemirror/state": codemirrorState,
  "@codemirror/text": codemirrorState,
  "@codemirror/view": codemirrorView,
  "@lezer/common": lezerCommon,
  "@lezer/highlight": lezerHighlight,
  "@lezer/lr": lezerLr,
};

const DEPRECATED_CODEMIRROR_MODULES: Record<string, unknown> = {
  "@codemirror/closebrackets": codemirrorAutocomplete,
  "@codemirror/comment": codemirrorCommands,
  "@codemirror/fold": codemirrorLanguage,
  "@codemirror/gutter": codemirrorView,
  "@codemirror/highlight": codemirrorLanguage,
  "@codemirror/history": codemirrorCommands,
  "@codemirror/matchbrackets": codemirrorLanguage,
  "@codemirror/panel": codemirrorView,
  "@codemirror/rangeset": codemirrorState,
  "@codemirror/rectangular-selection": codemirrorView,
  "@codemirror/stream-parser": codemirrorLanguage,
  "@codemirror/tooltip": codemirrorView,
};

export function createPluginRequire(app: App, pluginId: string): PluginRequire {
  return (id) => {
    if (hasOwn(DEPRECATED_CODEMIRROR_MODULES, id)) {
      console.error(
        new Error(
          `[CM6][${pluginId}] Using a deprecated package: "${id}".\n${DEPRECATED_CODEMIRROR_MESSAGE}`,
        ),
      );
      return DEPRECATED_CODEMIRROR_MODULES[id];
    }
    if (id === "obsidian") return createObsidianPluginModule(app);
    if (hasOwn(CODEMIRROR_MODULES, id)) return CODEMIRROR_MODULES[id];
    if (document.body.classList.contains("emulate-mobile")) {
      new Notice(`${pluginId} attempted to load NodeJS package: "${id}"`);
      console.error(new Error(`[${pluginId}] Attempting to load NodeJS package: "${id}"`));
      return null;
    }
    return (window as Window & { require?: (id: string) => unknown }).require?.(id);
  };
}

function hasOwn<T extends object>(object: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(object, key);
}
