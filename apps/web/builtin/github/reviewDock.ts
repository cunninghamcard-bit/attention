import type { App } from "../../app/App";
import { openGitNav } from "../git/review/GitNavView";
import type { ReviewSurface } from "../git/review/ReviewSurface";
import type { ReviewFile } from "../git/review/reviewModel";

/** Bridges a cloud review center (PR files / commit) to the right-docked
 * git-nav tree — the same session wiring GitReviewView uses, so both review
 * shells share one tree, one selection, one viewed state. The center owns the
 * files: it publishes them under a cloud source (which turns off the nav's
 * local-git self-loading) and listens for tree activations. Returns the
 * cleanup that detaches the listener; the caller runs it before mounting a
 * replacement surface and on close. */
export function dockCloudReview(
  app: App,
  surface: ReviewSurface,
  files: ReviewFile[],
  title: string,
): () => void {
  const session = app.git.reviewSession;
  session.setSource({ kind: "cloud", title });
  session.publishFiles(
    files.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    })),
  );
  session.selectPath(null);
  const ref = session.on<[string, number]>("path-activate", (path) => surface.activatePath(path));
  void openGitNav(app, true, "tree");
  return () => {
    session.offref(ref);
    // No listening center may leave no tree: rows that activate nothing are a
    // dead tree, worse than the honest "No changed files". The cloud source
    // stays — the local leaves ignore it and the nav's self-load guard keys
    // off it; the next center (cloud or local) republishes over this.
    session.publishFiles([]);
    session.selectPath(null);
  };
}
