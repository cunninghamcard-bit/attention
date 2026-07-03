/**
 * File-type presentation for the workspace: which icon a file gets and which
 * language key drives its accent color (styles/agent-workspace.css). Used by
 * the file explorer rows and code tab headers, VS Code-style.
 */

export interface FileTypeInfo {
  icon: string;
  /** Color key for CSS [data-lang]; empty for neutral files. */
  lang: string;
}

const BY_EXTENSION: Record<string, FileTypeInfo> = {
  md: { icon: "lucide-file-text", lang: "md" },
  ts: { icon: "lucide-file-code", lang: "ts" },
  tsx: { icon: "lucide-file-code", lang: "ts" },
  js: { icon: "lucide-file-code", lang: "js" },
  jsx: { icon: "lucide-file-code", lang: "js" },
  mjs: { icon: "lucide-file-code", lang: "js" },
  cjs: { icon: "lucide-file-code", lang: "js" },
  go: { icon: "lucide-file-code", lang: "go" },
  py: { icon: "lucide-file-code", lang: "py" },
  rs: { icon: "lucide-file-code", lang: "rs" },
  java: { icon: "lucide-file-code", lang: "java" },
  kt: { icon: "lucide-file-code", lang: "java" },
  swift: { icon: "lucide-file-code", lang: "swift" },
  rb: { icon: "lucide-file-code", lang: "rb" },
  php: { icon: "lucide-file-code", lang: "php" },
  lua: { icon: "lucide-file-code", lang: "lua" },
  c: { icon: "lucide-file-code", lang: "c" },
  h: { icon: "lucide-file-code", lang: "c" },
  cc: { icon: "lucide-file-code", lang: "c" },
  cpp: { icon: "lucide-file-code", lang: "c" },
  hpp: { icon: "lucide-file-code", lang: "c" },
  cs: { icon: "lucide-file-code", lang: "cs" },
  sh: { icon: "lucide-terminal", lang: "sh" },
  bash: { icon: "lucide-terminal", lang: "sh" },
  zsh: { icon: "lucide-terminal", lang: "sh" },
  fish: { icon: "lucide-terminal", lang: "sh" },
  json: { icon: "lucide-braces", lang: "json" },
  jsonc: { icon: "lucide-braces", lang: "json" },
  yaml: { icon: "lucide-braces", lang: "yaml" },
  yml: { icon: "lucide-braces", lang: "yaml" },
  toml: { icon: "lucide-braces", lang: "yaml" },
  ini: { icon: "lucide-braces", lang: "yaml" },
  conf: { icon: "lucide-braces", lang: "yaml" },
  base: { icon: "lucide-braces", lang: "yaml" },
  xml: { icon: "lucide-code", lang: "html" },
  html: { icon: "lucide-code", lang: "html" },
  vue: { icon: "lucide-code", lang: "vue" },
  svelte: { icon: "lucide-code", lang: "vue" },
  css: { icon: "lucide-palette", lang: "css" },
  scss: { icon: "lucide-palette", lang: "css" },
  less: { icon: "lucide-palette", lang: "css" },
  sql: { icon: "lucide-database", lang: "sql" },
  graphql: { icon: "lucide-database", lang: "sql" },
  proto: { icon: "lucide-file-code", lang: "cs" },
  csv: { icon: "lucide-table", lang: "csv" },
  txt: { icon: "lucide-file-text", lang: "" },
  log: { icon: "lucide-file-text", lang: "" },
  dockerfile: { icon: "lucide-terminal", lang: "docker" },
  canvas: { icon: "lucide-layout-dashboard", lang: "canvas" },
  pdf: { icon: "lucide-file-text", lang: "pdf" },
  png: { icon: "lucide-image", lang: "image" },
  jpg: { icon: "lucide-image", lang: "image" },
  jpeg: { icon: "lucide-image", lang: "image" },
  gif: { icon: "lucide-image", lang: "image" },
  svg: { icon: "lucide-image", lang: "image" },
  webp: { icon: "lucide-image", lang: "image" },
  bmp: { icon: "lucide-image", lang: "image" },
  mp3: { icon: "lucide-file-audio", lang: "media" },
  wav: { icon: "lucide-file-audio", lang: "media" },
  m4a: { icon: "lucide-file-audio", lang: "media" },
  ogg: { icon: "lucide-file-audio", lang: "media" },
  flac: { icon: "lucide-file-audio", lang: "media" },
  mp4: { icon: "lucide-file-video", lang: "media" },
  webm: { icon: "lucide-file-video", lang: "media" },
  mov: { icon: "lucide-file-video", lang: "media" },
  mkv: { icon: "lucide-file-video", lang: "media" },
};

// Extensionless files are identified by name (TFile.extension is "" for
// Dockerfile, Makefile and dotfiles).
const BY_NAME: Record<string, FileTypeInfo> = {
  dockerfile: { icon: "lucide-terminal", lang: "docker" },
  makefile: { icon: "lucide-terminal", lang: "sh" },
  ".gitignore": { icon: "lucide-braces", lang: "yaml" },
  ".gitattributes": { icon: "lucide-braces", lang: "yaml" },
  ".env": { icon: "lucide-braces", lang: "yaml" },
  license: { icon: "lucide-file-text", lang: "" },
};

export function getFileTypeInfo(name: string, extension: string): FileTypeInfo {
  const byName = BY_NAME[name.toLowerCase()];
  if (byName) return byName;
  const byExtension = BY_EXTENSION[extension.toLowerCase()];
  if (byExtension) return byExtension;
  if (extension === "") return { icon: "lucide-file-code", lang: "" };
  return { icon: "lucide-file", lang: "" };
}
