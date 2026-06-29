import { describe, expect, it } from "vitest";
import type { FileProperties } from "../properties/PropertyTypes";
import { TFile } from "../vault/TAbstractFile";
import { Vault } from "../vault/Vault";
import { ListValue, NullValue, NumberValue, StringValue } from "./BasesValues";
import { BasesQueryResult, buildBasesQueryResult, formatValue, groupBasesQueryResult } from "./BasesQueryResult";

describe("BasesQueryResult public value shape", () => {
  it("wraps entry and cell values in Bases Value objects while preserving render rows", () => {
    const vault = new Vault();
    const result = buildBasesQueryResult([
      fileProperties(vault, "Projects/A.md", { tags: ["project", "alpha"], score: 3 }),
      fileProperties(vault, "Projects/B.md", { tags: ["project"], score: 5 }),
    ], [
      { id: "name", property: "file.name", title: "Name" },
      { id: "tags", property: "note.tags", title: "Tags" },
      { id: "score", property: "note.score", title: "Score" },
      { id: "missing", property: "note.missing", title: "Missing" },
    ]);

    expect(result).toBeInstanceOf(BasesQueryResult);
    expect(result.properties).toEqual(["file.name", "note.tags", "note.score", "note.missing"]);
    expect(result.rows[0].cells[0].value).toBeInstanceOf(StringValue);
    expect(result.rows[0].cells[1].value).toBeInstanceOf(ListValue);
    expect(result.data[0].file).toBeInstanceOf(TFile);
    expect(result.data[0].file.path).toBe("Projects/A.md");
    expect(result.data[0].getValue("note.score")).toBeInstanceOf(NumberValue);
    expect(result.data[0].getValue("note.missing")).toBe(NullValue.value);
    expect(result.groupedData[0].hasKey()).toBe(false);
    expect(formatValue(result.rows[0].cells[1].value)).toBe("project, alpha");
  });

  it("preserves grouped rows and exposes summary values as Bases Values", () => {
    const vault = new Vault();
    const result = buildBasesQueryResult([
      fileProperties(vault, "Projects/A.md", { folder: "Projects", score: 3 }),
      fileProperties(vault, "Archive/B.md", { folder: "Archive", score: 5 }),
    ], [
      { id: "folder", property: "file.folder", title: "Folder" },
      { id: "score", property: "note.score", title: "Score" },
    ]);

    const grouped = groupBasesQueryResult(result, "folder");

    expect(grouped.groups?.map((group) => group.key)).toEqual(["Projects", "Archive"]);
    expect(grouped.groupedData[0].key).toBeInstanceOf(StringValue);
    expect(grouped.groupedData[0].hasKey()).toBe(true);
    expect(grouped.getSummaryValue(null, grouped.data, "note.score", "sum").toString()).toBe("8");
    expect(grouped.getSummaryValue(null, grouped.data, "note.score", "average").toString()).toBe("4");
  });
});

function fileProperties(vault: Vault, path: string, values: FileProperties["values"]): FileProperties {
  const file = new TFile(vault, path, { ctime: 10, mtime: 20, size: 30 });
  return { file, path, values };
}
