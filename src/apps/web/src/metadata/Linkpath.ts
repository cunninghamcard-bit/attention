export interface SplitLinkpath {
  path: string;
  subpath: string;
}

export interface ParsedLinktext {
  path: string;
  subpath?: string;
}

export function splitLinkpath(linkpath: string): SplitLinkpath {
  const index = linkpath.indexOf("#");
  if (index === -1) return { path: linkpath, subpath: "" };
  return { path: linkpath.slice(0, index), subpath: linkpath.slice(index) };
}

export function parseLinktext(linktext: string): ParsedLinktext {
  const pipeIndex = linktext.indexOf("|");
  const target = pipeIndex === -1 ? linktext : linktext.slice(0, pipeIndex);
  const { path, subpath } = splitLinkpath(target);
  const trimmedSubpath = subpath.startsWith("#") ? subpath.slice(1).trim() : subpath.trim();
  return {
    path: path.trim(),
    ...(trimmedSubpath ? { subpath: trimmedSubpath } : {}),
  };
}
