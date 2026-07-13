import { describe, expect, it } from "vitest";
import { GitReviewSession } from "@web/builtin/git/reviewSession";

describe("GitReviewSession", () => {
  it("re-emits path activation with an increasing sequence", () => {
    const session = new GitReviewSession();
    const activations: Array<[string, number]> = [];
    session.on<[string, number]>("path-activate", (path, seq) => activations.push([path, seq]));

    session.activatePath("src/a.ts");
    session.activatePath("src/a.ts");

    expect(session.selectedPath).toBe("src/a.ts");
    expect(activations).toEqual([
      ["src/a.ts", 1],
      ["src/a.ts", 2],
    ]);
  });
});
