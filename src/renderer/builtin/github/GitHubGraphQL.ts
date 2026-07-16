import type { HttpResponse, HttpTransport } from "./GitHubClient";
import type {
  ContributionCalendar,
  ContributionDay,
  ContributionLevel,
  ContributionWeek,
  RepositoryCard,
} from "./types";

/** The contribution heatmap, the four stat tiles and the pinned grid have no
 * REST equivalent — GitHub only exposes a contribution calendar through
 * GraphQL. This is the one GraphQL surface in the plugin; everything else stays
 * on `GitHubClient`'s REST.
 *
 * The query shapes mirror Oh My GitHub's `accounts.ts` (`accountOverviewQuery`,
 * `accountContributionsQuery`) rather than being written from scratch, down to
 * the year window it asks for. The field selections are trimmed to what this
 * app draws.
 */

/** GraphQL lives beside the REST root on github.com, but Enterprise splits
 * them: REST is `/api/v3`, GraphQL is `/api/graphql`. */
export function graphqlUrlForHost(host: string): string {
  if (host === "github.com" || host === "www.github.com") return "https://api.github.com/graphql";
  return `https://${host}/api/graphql`;
}

interface GraphRepositoryNode {
  name?: string | null;
  nameWithOwner?: string | null;
  owner?: { login?: string | null } | null;
  description?: string | null;
  isPrivate?: boolean;
  primaryLanguage?: { name?: string | null; color?: string | null } | null;
  stargazerCount?: number;
  forkCount?: number;
  url?: string | null;
}

interface GraphOverviewResponse {
  user?: {
    contributionsCollection?: { contributionYears?: number[] | null } | null;
    pinnedItems?: { nodes?: Array<GraphRepositoryNode | null> | null } | null;
  } | null;
  organization?: {
    pinnedItems?: { nodes?: Array<GraphRepositoryNode | null> | null } | null;
  } | null;
}

interface GraphContributionsResponse {
  user?: {
    contributionsCollection?: {
      restrictedContributionsCount?: number;
      totalCommitContributions?: number;
      totalIssueContributions?: number;
      totalPullRequestContributions?: number;
      totalPullRequestReviewContributions?: number;
      contributionCalendar?: {
        totalContributions?: number;
        weeks?: Array<{
          firstDay?: string | null;
          contributionDays?: Array<{
            date?: string | null;
            contributionCount?: number;
            contributionLevel?: string | null;
          } | null> | null;
        } | null> | null;
      } | null;
    } | null;
  } | null;
}

const REPOSITORY_CARD_FIELDS = `
  name
  nameWithOwner
  owner { login }
  description
  isPrivate
  primaryLanguage { name color }
  stargazerCount
  forkCount
  url
`;

/** A user's pinned grid plus the years its picker may offer. */
const USER_OVERVIEW_QUERY = `
  query UserOverview($login: String!, $pinnedFirst: Int!) {
    user(login: $login) {
      contributionsCollection { contributionYears }
      pinnedItems(first: $pinnedFirst, types: REPOSITORY) {
        nodes { ... on Repository { ${REPOSITORY_CARD_FIELDS} } }
      }
    }
  }
`;

/** An organization pins repositories too, but the type carries no
 * `contributionsCollection` — so this query cannot ask for years, and an org
 * page has no heatmap to put them in. */
const ORG_OVERVIEW_QUERY = `
  query OrgOverview($login: String!, $pinnedFirst: Int!) {
    organization(login: $login) {
      pinnedItems(first: $pinnedFirst, types: REPOSITORY) {
        nodes { ... on Repository { ${REPOSITORY_CARD_FIELDS} } }
      }
    }
  }
`;

const CONTRIBUTIONS_QUERY = `
  query UserContributions($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        restrictedContributionsCount
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        contributionCalendar {
          totalContributions
          weeks {
            firstDay
            contributionDays { date contributionCount contributionLevel }
          }
        }
      }
    }
  }
`;

const PINNED_LIMIT = 6;

/** GitHub's own quartile verdict, not ours: the server decides what counts as a
 * busy day for this account, and re-deriving it from counts would invent a
 * different scale than github.com shows. */
const LEVELS: Record<string, ContributionLevel> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

export class GitHubGraphQLClient {
  constructor(
    private readonly transport: HttpTransport,
    private readonly token: string | null,
    private readonly host: string = "github.com",
  ) {}

  /** A user's or organization's pinned repositories, plus the contribution
   * years a user's picker can offer (always empty for an organization). */
  async getProfileOverview(
    login: string,
    isOrganization: boolean,
  ): Promise<{ pinned: RepositoryCard[]; contributionYears: number[] }> {
    const data = await this.query<GraphOverviewResponse>(
      isOrganization ? ORG_OVERVIEW_QUERY : USER_OVERVIEW_QUERY,
      { login, pinnedFirst: PINNED_LIMIT },
    );
    const account = isOrganization ? data.organization : data.user;
    const pinned = (account?.pinnedItems?.nodes ?? [])
      .filter((node): node is GraphRepositoryNode => Boolean(node))
      .map(mapRepositoryCard);
    const years = isOrganization
      ? []
      : (data.user?.contributionsCollection?.contributionYears ?? []);
    // Newest first: the picker opens on the current year.
    return { pinned, contributionYears: [...years].sort((a, b) => b - a) };
  }

  /** One year of the heatmap and the tiles under it. Organizations have no
   * `contributionsCollection`, so callers must not ask for one. */
  async getContributions(login: string, year: number): Promise<ContributionCalendar> {
    const data = await this.query<GraphContributionsResponse>(CONTRIBUTIONS_QUERY, {
      login,
      // The same window Oh My GitHub asks for; GitHub clamps a partial current
      // year itself, so today's year needs no special case.
      from: `${year}-01-01T00:00:00Z`,
      to: `${year}-12-31T23:59:59Z`,
    });
    const collection = data.user?.contributionsCollection;
    const calendar = collection?.contributionCalendar;
    const weeks: ContributionWeek[] = (calendar?.weeks ?? [])
      .filter((week): week is NonNullable<typeof week> => Boolean(week))
      .map((week) => ({
        firstDay: week.firstDay ?? "",
        days: (week.contributionDays ?? [])
          .filter((day): day is NonNullable<typeof day> => Boolean(day))
          .map(
            (day): ContributionDay => ({
              date: day.date ?? "",
              count: day.contributionCount ?? 0,
              level: LEVELS[day.contributionLevel ?? "NONE"] ?? 0,
            }),
          ),
      }));
    return {
      year,
      totalContributions: calendar?.totalContributions ?? 0,
      restrictedContributions: collection?.restrictedContributionsCount ?? 0,
      weeks,
      stats: {
        commits: collection?.totalCommitContributions ?? 0,
        pullRequests: collection?.totalPullRequestContributions ?? 0,
        codeReviews: collection?.totalPullRequestReviewContributions ?? 0,
        issues: collection?.totalIssueContributions ?? 0,
      },
    };
  }

  /** GraphQL answers 200 with an `errors` array for a failed query — a bad
   * login, a field the token may not read — so a status check alone would hand
   * the view an empty page and call it success. */
  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (!this.token) throw new Error("Not authenticated");
    const res: HttpResponse = await this.transport({
      url: graphqlUrlForHost(this.host),
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "Workbench-GitHub",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status >= 400) throw new Error(graphqlHttpError(res));
    const payload = res.json as { data?: T; errors?: Array<{ message?: string }> } | null;
    if (payload?.errors?.length) {
      throw new Error(
        payload.errors
          .map((e) => e.message)
          .filter(Boolean)
          .join("; "),
      );
    }
    if (!payload?.data) throw new Error("GitHub returned no data");
    return payload.data;
  }
}

function graphqlHttpError(res: HttpResponse): string {
  const message = (res.json as { message?: string } | null)?.message;
  return message ?? `GitHub GraphQL request failed (${res.status})`;
}

function mapRepositoryCard(node: GraphRepositoryNode): RepositoryCard {
  const nameWithOwner = node.nameWithOwner ?? "";
  const [ownerFromPath = "", repoFromPath = ""] = nameWithOwner.split("/");
  return {
    owner: node.owner?.login ?? ownerFromPath,
    repo: node.name ?? repoFromPath,
    nameWithOwner,
    description: node.description ?? null,
    language: node.primaryLanguage?.name ?? null,
    languageColor: node.primaryLanguage?.color ?? null,
    stars: node.stargazerCount ?? 0,
    forks: node.forkCount ?? 0,
    isPrivate: node.isPrivate ?? false,
    url: node.url ?? "",
  };
}
