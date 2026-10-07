import { expect, it, vi } from "vitest";
import { createTestApp, disposeTestApps } from "./TestApp";

it("stops sidedock animations before they can resize a disposed app", async () => {
  const app = createTestApp();
  await app.ready;
  const trigger = vi.spyOn(app.workspace, "trigger");
  app.workspace.rightSplit.collapse();
  app.workspace.rightSplit.expand();

  await disposeTestApps();

  const resizeCount = () => trigger.mock.calls.filter(([event]) => event === "resize").length;
  const afterDisposal = resizeCount();
  // The sidedock's 140ms transition has a 50ms settlement fallback. A leaked
  // completion would schedule another workspace resize after disposal.
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  expect(resizeCount()).toBe(afterDisposal);
});
