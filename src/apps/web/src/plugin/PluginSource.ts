export const INLINE_SOURCE_MAP_COMMENT =
  /^\/\/[@#] sourceMappingURL=data:application\/json(?:;charset[:=][^;]+)?;base64,.*$/gm;
export const NO_SOURCE_MAP_MARKER = "\n/* nosourcemap */";

export function prepareDownloadedMainJs(mainJs: string): string {
  return removeInlineSourceMap(mainJs) + NO_SOURCE_MAP_MARKER;
}

export function prepareLoadedMainJs(mainJs: string): string {
  return mainJs.endsWith(NO_SOURCE_MAP_MARKER) ? mainJs : removeInlineSourceMap(mainJs);
}

export function appendPluginSourceUrl(mainJs: string, pluginId: string): string {
  return `${mainJs}\n//# sourceURL=plugin:${encodeURIComponent(pluginId)}`;
}

export function wrapCommonJsPluginSource(mainJs: string, pluginId: string): string {
  return `${wrapCommonJsFunctionSource(prepareLoadedMainJs(mainJs))}\n//# sourceURL=plugin:${encodeURIComponent(pluginId)}\n`;
}

function wrapCommonJsFunctionSource(mainJs: string): string {
  return `(function anonymous(require,module,exports){${mainJs}\n})`;
}

function removeInlineSourceMap(mainJs: string): string {
  return mainJs.replace(INLINE_SOURCE_MAP_COMMENT, "");
}
