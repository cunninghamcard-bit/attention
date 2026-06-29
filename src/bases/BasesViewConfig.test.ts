import { describe, expect, it } from "vitest";
import type { FileProperties } from "../properties/PropertyTypes";
import { TFile } from "../vault/TAbstractFile";
import { Vault } from "../vault/Vault";
import type { BasesView } from "./BasesView";
import { BasesViewConfig, type BasesFileConfig } from "./BasesViewConfig";
import { buildBasesQueryResult } from "./BasesQueryResult";
import { NumberValue } from "./BasesValues";

describe("BasesViewConfig public view configuration", () => {
  it("wraps a single Bases view entry while preserving the owning base config", () => {
    const fileConfig: BasesFileConfig = {
      id: "base",
      name: "Projects",
      query: { sort: [{ property: "file.name", direction: "asc" }] },
      columns: [
        { id: "name", property: "file.name", title: "File" },
        { id: "score", property: "note.score", title: "Score" },
      ],
      properties: {
        "note.status": { displayName: "Status" },
      },
      views: [{
        id: "cards",
        name: "Cards",
        type: "cards",
        order: ["file.name", "score"],
        sort: [{ property: "note.score", direction: "desc" }],
        data: { cover: "note.image" },
      }],
      activeView: "cards",
    };
    const config = new BasesViewConfig(fileConfig, "cards");

    expect(config.name).toBe("Cards");
    config.name = "Gallery";
    expect(fileConfig.views?.[0].name).toBe("Gallery");
    expect(config.get("cover")).toBe("note.image");
    config.set("density", "compact");
    expect(fileConfig.views?.[0].data?.density).toBe("compact");
    expect(config.getAsPropertyId("cover")).toBe("note.image");
    expect(config.getOrder()).toEqual(["file.name", "note.score"]);
    expect(config.getSort()).toEqual([{ property: "note.score", direction: "DESC" }]);
    expect(config.getDisplayName("file.name")).toBe("File");
    expect(config.getDisplayName("note.status")).toBe("Status");
    expect(config.serialize()).toEqual(fileConfig);
  });

  it("evaluates formulas through the active Bases view data context", () => {
    const vault = new Vault();
    const file = new TFile(vault, "Projects/A.md");
    const properties: FileProperties = { file, path: file.path, values: { score: 7 } };
    const result = buildBasesQueryResult([properties], [
      { id: "score", property: "note.score", title: "Score" },
    ]);
    const fileConfig: BasesFileConfig = {
      id: "base",
      name: "Projects",
      query: {},
      columns: [{ id: "score", property: "note.score", title: "Score" }],
      formulas: { doubled: "note.score" },
      views: [{ id: "table", name: "Table", type: "table", data: { value: "formula.doubled" } }],
      activeView: "table",
    };
    const config = new BasesViewConfig(fileConfig, "table");
    const view = { data: result } as BasesView;

    const value = config.getEvaluatedFormula(view, "value");

    expect(value).toBeInstanceOf(NumberValue);
    expect(value.toString()).toBe("7");
  });
});
