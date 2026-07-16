import type {
  ContributionCalendar,
  GitHubActor,
  GitHubProfile,
  GitHubProfileOverview,
  RepositoryCard,
} from "./types";

/**
 * The profile view's data-source contract — the method names the view calls on
 * `app.github`. The shared shapes live in `types.ts` (commit 1d038fd, the
 * introspected boundary); this file only names the calls. The view treats a
 * missing method as "data layer not wired yet" and renders a quiet
 * placeholder, and a rejection as that block's error state — the page never
 * dies with the data layer (spec: GraphQL failure degrades the heatmap, not
 * the leaf).
 *
 * REST half (GitHubClient): getProfile / listStarredRepositories /
 * listFollowers. GraphQL half (GitHubGraphQL): getProfileOverview /
 * getContributions. Starred cards come without `languageColor` (REST carries
 * no language colours — verified against live data); the card renderer treats
 * it as optional.
 */
export interface ProfileDataSource {
  /** REST; must work for users and organizations alike — its
   * `isOrganization` decides which sections exist at all. */
  getProfile(login: string): Promise<GitHubProfile>;
  /** GraphQL; org logins return `pinned` and empty `contributionYears`. */
  getProfileOverview(login: string): Promise<GitHubProfileOverview>;
  /** GraphQL; users only. */
  getContributions(login: string, year?: number): Promise<ContributionCalendar>;
  /** REST; users only. One card shape with the pinned grid. */
  listStarredRepositories(login: string): Promise<RepositoryCard[]>;
  /** REST; users only. */
  listFollowers(login: string): Promise<GitHubActor[]>;
}
