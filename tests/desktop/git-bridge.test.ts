import { describe, expect, it } from "vitest";
import { gravatarUrl } from "@desktop/git-bridge";

describe("git bridge avatars", () => {
  it("hashes normalized Git author email for Gravatar", () => {
    expect(gravatarUrl("  MyEmailAddress@example.com ")).toBe(
      "https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?s=80&d=identicon",
    );
  });
});
