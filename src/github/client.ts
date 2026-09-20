import { z } from "zod";
import type { StructuredLogger } from "../api/logger";
import { GitHubError } from "./errors";
import type {
  GitHubClient,
  GitHubCommit,
  GitHubIssue,
  GitHubPage,
  GitHubRepository,
  GitHubTree,
} from "./types";

const repositorySchema = z.object({
  id: z.number(),
  full_name: z.string(),
  name: z.string(),
  owner: z.object({ login: z.string() }),
  default_branch: z.string(),
  private: z.boolean(),
  html_url: z.string().url(),
  updated_at: z.string(),
});
const issueSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  user: z.object({ login: z.string() }).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  html_url: z.string().url(),
  pull_request: z.object({ url: z.string().url() }).optional(),
});
const commitSchema = z.object({
  sha: z.string(),
  commit: z.object({
    message: z.string(),
    author: z.object({ name: z.string(), date: z.string() }).nullable(),
  }),
  html_url: z.string().url(),
});
const treeSchema = z.object({
  sha: z.string(),
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      mode: z.string(),
      type: z.enum(["blob", "tree", "commit"]),
      sha: z.string(),
      size: z.number().optional(),
      url: z.string().url(),
    }),
  ),
});
const searchSchema = z.object({ items: z.array(issueSchema), total_count: z.number().int() });

export type GitHubTokenProvider = () => Promise<string>;
export type GitHubFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type GitHubClientOptions = {
  tokenProvider: GitHubTokenProvider;
  fetcher?: GitHubFetch;
  logger?: StructuredLogger;
  baseUrl?: string;
  maxAttempts?: number;
  maxPages?: number;
};

function pageResult<T>(items: T[], page: number, maxPages: number): GitHubPage<T> {
  return items.length === 100 && page < maxPages ? { items, nextPage: page + 1 } : { items };
}

/**
 * GitHub's search API answers HTTP 422 for an invalid query: a `q` longer than
 * 256 characters, more than five AND/OR/NOT operators, request syntax it cannot
 * parse, or a query that omits an explicit issue/pull-request qualifier. An
 * issue title is untrusted repository text of unbounded length, so only whole
 * tokens from a strict character set are forwarded; every quoting character and
 * search operator is outside that set, so repository content can never inject
 * search syntax. Titles with no usable token fall back to the qualifiers alone.
 */
export const maxSearchQueryLength = 256;
const maxSearchOperators = 5;
/**
 * GitHub's search endpoint rejects a query without this qualifier (HTTP 422:
 * "Query must include 'is:issue' or 'is:pull-request'"). RepoSherlock looks for
 * related issues, so every generated query pins it.
 */
const relatedIssueQualifier = "is:issue";
/** The same safe token set the engine and retrieval tokenizers already use. */
const searchTokenPattern = /[A-Za-z0-9_$-]+/g;

/** Number of boolean operators GitHub would interpret in a query. */
export function countSearchOperators(query: string): number {
  return (query.match(/\b(?:AND|OR|NOT)\b/g) ?? []).length;
}

export function buildSearchQuery(owner: string, name: string, query: string): string {
  const qualifiers = `repo:${owner}/${name} ${relatedIssueQualifier}`;
  const budget = Math.max(0, maxSearchQueryLength - qualifiers.length - 1);
  const terms: string[] = [];
  let operators = 0;
  let length = 0;
  for (const raw of query.match(searchTokenPattern) ?? []) {
    // A leading "-" would be a GitHub negation operator, not a search term.
    const term = raw.replace(/^-+/, "");
    if (term.length < 2 || !/[A-Za-z0-9]/.test(term)) continue;
    if (/^(and|or|not)$/i.test(term)) {
      if (operators >= maxSearchOperators) continue;
      operators += 1;
    }
    const nextLength = length === 0 ? term.length : length + 1 + term.length;
    if (nextLength > budget) continue;
    terms.push(term);
    length = nextLength;
  }
  return terms.length === 0 ? qualifiers : `${qualifiers} ${terms.join(" ")}`;
}

/** Drops the query string so a logged path can never carry repository content. */
function requestPathOnly(path: string): string {
  return path.split("?")[0] ?? path;
}

/**
 * Reads GitHub's validation detail from a failed response. Only the structured
 * error fields are kept, and the result is bounded; credentials and response
 * bodies are never returned or logged verbatim.
 */
async function readGitHubErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await response.text());
    if (!parsed || typeof parsed !== "object") return undefined;
    const body = parsed as { message?: unknown; errors?: unknown };
    const parts: string[] = [];
    if (typeof body.message === "string") parts.push(body.message);
    if (Array.isArray(body.errors))
      for (const item of body.errors.slice(0, 3)) {
        if (!item || typeof item !== "object") continue;
        const error = item as {
          resource?: unknown;
          field?: unknown;
          code?: unknown;
          message?: unknown;
        };
        const locator = [error.resource, error.field, error.code]
          .filter((value): value is string => typeof value === "string")
          .join("/");
        if (locator.length > 0) parts.push(locator);
        if (typeof error.message === "string") parts.push(error.message);
      }
    const detail = parts.join(" | ").replace(/\s+/g, " ").trim();
    return detail.length === 0 ? undefined : detail.slice(0, 240);
  } catch {
    return undefined;
  }
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.github.com";
  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? 3, 1), 5);
  const maxPages = Math.min(Math.max(options.maxPages ?? 10, 1), 25);

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    accept = "application/vnd.github+json",
  ): Promise<T> {
    const token = await options.tokenProvider();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetcher(`${baseUrl}${path}`, {
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (response.ok) {
        if (accept === "application/vnd.github+json; archive=tarball")
          return new Uint8Array(await response.arrayBuffer()) as T;
        try {
          return schema.parse(await response.json());
        } catch (cause) {
          throw new GitHubError(
            "GITHUB_INVALID_RESPONSE",
            "GitHub response did not match the expected schema",
            response.status,
            cause,
          );
        }
      }
      const retryable =
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;
      if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
        const resetAt = Number(response.headers.get("x-ratelimit-reset"));
        const waitMs = Number.isFinite(resetAt) ? Math.max(0, resetAt * 1000 - Date.now()) : 1000;
        if (attempt < maxAttempts) {
          options.logger?.warn("github_rate_limit_retry", {
            path: requestPathOnly(path),
            attempt,
            waitMs: Math.min(waitMs, 10_000),
          });
          await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 10_000)));
          continue;
        }
        throw new GitHubError(
          "GITHUB_RATE_LIMITED",
          "GitHub API rate limit exceeded",
          response.status,
        );
      }
      if (!retryable || attempt === maxAttempts) {
        const detail = await readGitHubErrorDetail(response);
        options.logger?.error("github_request_failed", {
          path: requestPathOnly(path),
          status: response.status,
          ...(detail === undefined ? {} : { detail }),
        });
        throw new GitHubError(
          "GITHUB_REQUEST_FAILED",
          `GitHub request failed with status ${response.status}`,
          response.status,
          detail,
        );
      }
      options.logger?.warn("github_request_retry", {
        path: requestPathOnly(path),
        status: response.status,
        attempt,
      });
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 10_000) : attempt * 250,
        ),
      );
    }
    throw new GitHubError("GITHUB_REQUEST_FAILED", "GitHub request retry budget exhausted");
  }

  const list = <T>(path: string, schema: z.ZodType<T[]>, page = 1) =>
    request(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, schema).then(
      (items) => pageResult(items, page, maxPages),
    );
  return {
    listAccessibleRepositories: (page = 1) =>
      list(
        "/user/repos?affiliation=owner,collaborator,organization_member&sort=updated",
        z.array(repositorySchema),
        page,
      ),
    getRepository: (owner, name) =>
      request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, repositorySchema),
    listIssues: (owner, name, page = 1) =>
      list(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?state=all`,
        z.array(issueSchema),
        page,
      ),
    getIssue: (owner, name, issueNumber) =>
      request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${issueNumber}`,
        issueSchema,
      ),
    getTree: (owner, name, ref) =>
      request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        treeSchema,
      ),
    getFile: async (owner, name, path, ref) => {
      const result = await request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
        z.object({ content: z.string(), encoding: z.literal("base64") }),
      );
      return Uint8Array.from(Buffer.from(result.content.replace(/\n/g, ""), "base64"));
    },
    downloadRepositorySource: async (owner, name, ref) =>
      request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tarball/${encodeURIComponent(ref)}`,
        z.any(),
        "application/vnd.github+json; archive=tarball",
      ),
    listCommits: (owner, name, page = 1) =>
      list(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits`,
        z.array(commitSchema),
        page,
      ),
    getCommit: (owner, name, sha) =>
      request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`,
        commitSchema,
      ),
    searchRelated: (owner, name, query, page = 1) => {
      const bounded = buildSearchQuery(owner, name, query);
      // Bounded, non-sensitive request diagnostics: never the token, the raw
      // issue title, or the composed query.
      options.logger?.info("github_search_query", {
        owner,
        name,
        queryLength: query.length,
        boundedLength: bounded.length,
        operators: countSearchOperators(bounded),
        sanitized: bounded !== `repo:${owner}/${name} ${relatedIssueQualifier} ${query}`,
      });
      return request(
        `/search/issues?q=${encodeURIComponent(bounded)}&per_page=100&page=${page}`,
        searchSchema,
      ).then((result) => pageResult(result.items, page, maxPages));
    },
  };
}
