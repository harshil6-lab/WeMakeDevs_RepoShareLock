import { describe, expect, it } from "vitest";
import { buildSearchQuery, createGitHubClient } from "../src/github/client";
import { ingestRepository } from "../src/github/ingestion";
import type { GitHubClient } from "../src/github/types";

const fixture = {
  repository: {
    id: 123,
    full_name: "demo/golden-repo",
    name: "golden-repo",
    owner: { login: "demo" },
    default_branch: "main",
    private: false,
    html_url: "https://github.com/demo/golden-repo",
    updated_at: "2026-01-01T00:00:00Z",
  },
  tree: {
    sha: "abc123",
    truncated: false,
    tree: [
      {
        path: "src/index.ts",
        mode: "100644",
        type: "blob",
        sha: "file1",
        url: "https://api.github.com/x",
        size: 20,
      },
    ],
  },
  issue: {
    number: 7,
    title: "Golden issue",
    state: "open",
    user: { login: "demo" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    html_url: "https://github.com/demo/golden-repo/issues/7",
  },
};

function response(body: unknown, status = 200, headers = new Headers()): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("GitHub client", () => {
  it("parses real-shaped repository responses and paginates", async () => {
    const calls: string[] = [];
    const client = createGitHubClient({
      tokenProvider: async () => "secret",
      fetcher: async (url, init) => {
        calls.push(`${url}`);
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret");
        return response([fixture.repository]);
      },
    });
    const result = await client.listAccessibleRepositories();
    expect(result.items[0]?.full_name).toBe("demo/golden-repo");
    expect(calls[0]).toContain("per_page=100&page=1");
  });

  it("retries transient GitHub failures within the request budget", async () => {
    let attempts = 0;
    const client = createGitHubClient({
      tokenProvider: async () => "secret",
      fetcher: async () => {
        attempts += 1;
        return attempts === 1 ? response({}, 503) : response(fixture.repository);
      },
    });
    expect((await client.getRepository("demo", "golden-repo")).id).toBe(123);
    expect(attempts).toBe(2);
  });
});

describe("GitHub related-issue search", () => {
  /** Emulates the GitHub search query validation that answers HTTP 422. */
  function githubSearchResponse(url: string): Response {
    const query = new URL(url).searchParams.get("q") ?? "";
    const operators = query.match(/\b(AND|OR|NOT)\b/g) ?? [];
    const quotes = query.match(/"/g) ?? [];
    if (query.length > 256 || operators.length > 5 || quotes.length % 2 !== 0)
      return response({ message: "Validation Failed" }, 422);
    // The exact production 422 from the GitHub search endpoint.
    if (!/\bis:issue\b|\bis:pull-request\b/.test(query))
      return response(
        {
          message: "Validation Failed",
          errors: [{ message: "Query must include 'is:issue' or 'is:pull-request'" }],
        },
        422,
      );
    return response({ items: [fixture.issue], total_count: 1 });
  }

  function clientCapturing(calls: string[]) {
    return createGitHubClient({
      tokenProvider: async () => "secret",
      fetcher: async (url) => {
        calls.push(`${url}`);
        return githubSearchResponse(`${url}`);
      },
    });
  }

  it("sends the repository qualifier and the issue title as the search query", async () => {
    const calls: string[] = [];
    const page = await clientCapturing(calls).searchRelated(
      "demo",
      "golden-repo",
      "Payment timeout",
    );
    expect(page.items[0]?.number).toBe(7);
    // The exact request URL: repository qualifier, the required issue
    // qualifier, the bounded terms, then pagination.
    expect(calls[0]).toBe(
      `https://api.github.com/search/issues?q=${encodeURIComponent("repo:demo/golden-repo is:issue Payment timeout")}&per_page=100&page=1`,
    );
  });

  it("reproduces the over-long query and bounds it within the GitHub limit", async () => {
    const title = `Payment webhook intermittently times out ${"and retries without a duplicate guard ".repeat(8)}`;
    // The previous implementation forwarded this title verbatim, which was long
    // enough for GitHub to reject the request with HTTP 422.
    expect(`repo:harshil6-lab/certifypro is:issue ${title}`.length).toBeGreaterThan(256);

    const calls: string[] = [];
    const page = await clientCapturing(calls).searchRelated("harshil6-lab", "certifypro", title);
    expect(page.items[0]?.number).toBe(7);
    const query = new URL(calls[0]!).searchParams.get("q") ?? "";
    expect(query.startsWith("repo:harshil6-lab/certifypro is:issue ")).toBe(true);
    expect(query.length).toBeLessThanOrEqual(256);
  });

  it("strips search syntax that makes GitHub reject a query", async () => {
    const title =
      'Fix "signature" webhook: (retry|backoff)* AND charges AND settle AND refund AND ledger AND timeout';
    const calls: string[] = [];
    const page = await clientCapturing(calls).searchRelated("harshil6-lab", "certifypro", title);
    expect(page.items[0]?.number).toBe(7);
    const query = new URL(calls[0]!).searchParams.get("q") ?? "";
    const terms = query.replace(/^repo:\S+\s+is:issue\s*/, "");
    expect(terms).not.toMatch(/["'\\:()[\]{}#|*]/);
    expect(query).toContain("repo:harshil6-lab/certifypro is:issue ");
    expect((query.match(/\b(AND|OR|NOT)\b/g) ?? []).length).toBeLessThanOrEqual(5);
  });

  it("logs bounded search diagnostics and captures GitHub's 422 validation detail", async () => {
    const logs: Array<{ message: string; context: Record<string, unknown> }> = [];
    const logger = {
      debug: () => {},
      info: (message: string, context: Record<string, unknown> = {}) =>
        logs.push({ message, context }),
      warn: (message: string, context: Record<string, unknown> = {}) =>
        logs.push({ message, context }),
      error: (message: string, context: Record<string, unknown> = {}) =>
        logs.push({ message, context }),
    };
    const title = 'Payment webhook "signature" fails';
    const client = createGitHubClient({
      tokenProvider: async () => "secret",
      logger,
      fetcher: async () =>
        response(
          {
            message: "Validation Failed",
            errors: [{ resource: "Search", field: "q", code: "invalid" }],
            documentation_url: "https://docs.github.com/v3/search",
          },
          422,
        ),
    });

    await expect(client.searchRelated("harshil6-lab", "certifypro", title)).rejects.toMatchObject({
      code: "GITHUB_REQUEST_FAILED",
      status: 422,
      message: "GitHub request failed with status 422",
    });

    const queryLog = logs.find((entry) => entry.message === "github_search_query");
    expect(queryLog?.context).toMatchObject({
      owner: "harshil6-lab",
      name: "certifypro",
      queryLength: title.length,
      sanitized: true,
    });
    expect(Number(queryLog?.context.boundedLength)).toBeLessThanOrEqual(256);

    const failLog = logs.find((entry) => entry.message === "github_request_failed");
    expect(failLog?.context).toMatchObject({ path: "/search/issues", status: 422 });
    expect(String(failLog?.context.detail)).toContain("Validation Failed");
    expect(String(failLog?.context.detail)).toContain("Search/q/invalid");

    // Never log the token, the raw issue title, or the composed search query.
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain(title);
    expect(serialized).not.toContain("repo:harshil6-lab/certifypro");
  });

  it("falls back to a valid issue search when the title has no usable term", async () => {
    expect(buildSearchQuery("demo", "golden-repo", '  ""  ')).toBe(
      "repo:demo/golden-repo is:issue",
    );

    const calls: string[] = [];
    const page = await clientCapturing(calls).searchRelated("demo", "golden-repo", ' "" ');
    expect(page.items[0]?.number).toBe(7);
    expect(new URL(calls[0]!).searchParams.get("q")).toBe("repo:demo/golden-repo is:issue");
  });
});

describe("repository ingestion", () => {
  it("stores only response-backed archive, source, and issue data", async () => {
    const calls: string[] = [];
    const github: GitHubClient = {
      getRepository: async () => fixture.repository,
      getTree: async () => fixture.tree,
      downloadRepositorySource: async () => new Uint8Array([1]),
      getFile: async () => new TextEncoder().encode("export const answer = 42;"),
      listIssues: async () => ({ items: [fixture.issue] }),
      getIssue: async () => fixture.issue,
      listAccessibleRepositories: async () => ({ items: [fixture.repository] }),
      listCommits: async () => ({ items: [] }),
      getCommit: async () => {
        throw new Error("unused");
      },
      searchRelated: async () => ({ items: [] }),
    };
    const storage = {
      repositories: {
        create: async (record: unknown) => calls.push(`repository:${JSON.stringify(record)}`),
        updateIndexingStatus: async (_id: string, status: string) => calls.push(`status:${status}`),
      },
      files: { put: async (record: unknown) => calls.push(`file:${JSON.stringify(record)}`) },
      chunks: {
        put: async (record: unknown) => calls.push(`chunk:${JSON.stringify(record)}`),
        listForRepository: async () => ({ items: [] }),
      },
      commits: { put: async (record: unknown) => calls.push(`commit:${JSON.stringify(record)}`) },
      issues: { put: async (record: unknown) => calls.push(`issue:${JSON.stringify(record)}`) },
    } as never;
    const artifacts = {
      putSnapshot: async () => "snapshot",
      putRawArtifact: async () => "raw",
      putChunk: async () => "chunk",
    } as never;
    const result = await ingestRepository(github, storage, artifacts, {
      userId: "user-1",
      owner: "demo",
      name: "golden-repo",
    });
    expect(result).toEqual({
      repositoryId: "123",
      snapshotVersion: "abc123",
      filesStored: 1,
      issuesStored: 1,
    });
    expect(calls.some((call) => call.includes("issue:"))).toBe(true);
    expect(calls.at(-1)).toBe("status:completed");
  });
});
