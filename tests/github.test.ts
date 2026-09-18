import { describe, expect, it } from "vitest";
import { createGitHubClient } from "../src/github/client";
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
