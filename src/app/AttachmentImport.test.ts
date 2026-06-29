import { afterEach, describe, expect, it, vi } from "vitest";
import { createAttachmentImportFile, getAttachmentFilesFromDataTransfer } from "./AttachmentImport";

const originalRequire = Object.getOwnPropertyDescriptor(globalThis, "require");

afterEach(() => {
  if (originalRequire) Object.defineProperty(globalThis, "require", originalRequire);
  else delete (globalThis as typeof globalThis & { require?: unknown }).require;
});

describe("AttachmentImport", () => {
  it("uses Electron webUtils for the real file path before legacy fallbacks", () => {
    const file = new File([new Uint8Array([1])], "external.png");
    const getPathForFile = vi.fn(() => "/Users/example/external.png");
    Object.defineProperty(file, "path", { configurable: true, value: "/legacy/external.png" });
    Object.defineProperty(globalThis, "require", {
      configurable: true,
      value: (moduleName: string) => moduleName === "electron" ? { webUtils: { getPathForFile } } : {},
    });

    const record = createAttachmentImportFile(file, false);

    expect(record.filepath).toBe("/Users/example/external.png");
    expect(getPathForFile).toHaveBeenCalledWith(file);
  });

  it("supports original-style mode plus metadata-only extraction", () => {
    const file = new File([new Uint8Array([1])], "Example Site.webloc");
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");
    const dataTransfer = createDropDataTransfer([file]);

    const records = getAttachmentFilesFromDataTransfer(dataTransfer, "drop", false);

    expect(records).toMatchObject([{ name: "Example Site", extension: "webloc" }]);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

function createDropDataTransfer(files: File[]): DataTransfer {
  const items = files.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  })) as DataTransferItem[];
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: files as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    types: files.length ? ["Files"] : [],
    clearData: () => {},
    getData: () => "",
    setData: () => {},
    setDragImage: () => {},
  } as unknown as DataTransfer;
}
