import type { TFile } from "../vault/TAbstractFile";

export interface FoldRange {
  from: number;
  to: number;
}

export interface FoldInfo {
  folds: FoldRange[];
  lines: number;
}

export class FoldManager {
  private readonly foldInfoByPath = new Map<string, FoldInfo>();

  save(file: TFile | null | undefined, info: FoldInfo | null | undefined): void {
    if (!file || !info) return;
    this.foldInfoByPath.set(file.path, cloneFoldInfo(info));
  }

  get(file: TFile | null | undefined): FoldInfo | null {
    if (!file) return null;
    const info = this.foldInfoByPath.get(file.path);
    return info ? cloneFoldInfo(info) : null;
  }

  delete(file: TFile | null | undefined): void {
    if (file) this.foldInfoByPath.delete(file.path);
  }
}

function cloneFoldInfo(info: FoldInfo): FoldInfo {
  return {
    lines: info.lines,
    folds: info.folds.map((fold) => ({ from: fold.from, to: fold.to })),
  };
}
