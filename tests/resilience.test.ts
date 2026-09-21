import { afterEach, describe, expect, it } from "vitest";
import { createGitHubClient } from "../src/github/client";
import { ingestRepository } from "../src/github/ingestion";
import { createInvestigationWorker } from "../src/api/worker";
import { createDynamoRepository } from "../src/storage/dynamo-repository";
import { createS3ArtifactRepository } from "../src/storage/s3-repository";
import { createApiRouter } from "../src/api/router";
import { testAuth } from "./helpers/auth";
import { createInvestigationService } from "../src/api/service";
import { apiClient } from "../src/api/client";
import type { InvestigationResult } from "../src/investigation/engine";
import type { StructuredLogger } from "../src/api/logger";
import type { GitHubClient } from "../src/github/types";
import {
  createInMemoryArtifactRepository,
  createInMemoryRepositoryStore,
} from "./golden/in-memory-store";

const result: InvestigationResult = {
  repositoryId: "repo-1",
  issueNumber: 42,
  summary: "The handler waits before acknowledgement.",
  claims: [{ text: "The handler waits before acknowledgement.", evidenceIds: ["file:1"] }],
  evidence: [
    {
      evidenceId: "file:1",
      excerpt: "return acknowledge();",
      provenance: {
        type: "repository_file",
        repositoryId: "repo-1",
        filePath: "src/payment.ts",
        startLine: 2,
        endLine: 2,
        commitSha: "sha-1",
      },
    },
  ],
  status: "completed",
};

type CapturedLog = { level: string; message: string; context: Record<string, unknown> };

function createCapturingLogger() {
  const entries: CapturedLog[] = [];
  const write =
    (level: string) =>
    (message: string, context: Record<string, unknown> = {}): void => {
      entries.push({ level, message, context });
    };
  const logger: StructuredLogger = {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
  };
  return { entries, logger };
}

async function waitFor(condition: () => boolean, label: string, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for " + label);
}

const request = (url: string, init?: RequestInit) => new Request("http://localhost" + url, init);

describe("GitHub failure handling", () => {
  it("surfaces a distinct rate-limit error after bounded retries", async () => {
    let attempts = 0;
    const client = createGitHubClient({
      tokenProvider: async () => "secret",
      maxAttempts: 3,
      fetcher: async () => {
        attempts += 1;
        return new Response("{}", {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) - 30),
          },
        });
      },
    });
    await expect(client.getRepository("acme", "payments")).rejects.toMatchObject({
      code: "GITHUB_RATE_LIMITED",
    });
    expect(attempts).toBe(3);
  });

  it("fails controlled when GitHub is unavailable", async () => {
    let attempts = 0;
    const client = createGitHubClient({
      tokenProvider: async () => "secret",
      maxAttempts: 2,
      fetcher: async () => {
        attempts += 1;
        return new Response("{}", { status: 503 });
      },
    });
    await expect(client.getRepository("acme", "payments")).rejects.toMatchObject({
      code: "GITHUB_REQUEST_FAILED",
    });
    expect(attempts).toBe(2);
  });
});

describe("ingestion edge cases", () => {
  it("indexes an empty repository without fabricating files or issues", async () => {
    const store = createInMemoryRepositoryStore();
    const artifacts = createInMemoryArtifactRepository();
    const github = {
      getRepository: async () => ({
        id: 7,
        full_name: "acme/empty",
        name: "empty",
        owner: { login: "acme" },
        default_branch: "main",
        private: false,
        html_url: "https://github.com/acme/empty",
        updated_at: "2026-01-01T00:00:00Z",
      }),
      getTree: async () => ({ sha: "empty-tree", truncated: false, tree: [] }),
      downloadRepositorySource: async () => new Uint8Array(),
      getFile: async () => {
        throw new Error("getFile must not run for an empty tree");
      },
      listCommits: async () => ({ items: [] }),
      listIssues: async () => ({ items: [] }),
    } as unknown as GitHubClient;
    const outcome = await ingestRepository(github, store, artifacts, {
      userId: "user-1",
      owner: "acme",
      name: "empty",
    });
    expect(outcome).toMatchObject({ filesStored: 0, issuesStored: 0 });
    const repository = await store.repositories.get("7");
    expect(repository?.indexingStatus).toBe("completed");
    expect(store.filesStored).toHaveLength(0);
  });
});

describe("storage failure handling", () => {
  it("wraps DynamoDB read failures as a controlled storage error", async () => {
    const repository = createDynamoRepository({
      tableName: "table",
      client: {
        send: async () => {
          throw new Error("dynamodb unavailable");
        },
      } as never,
    });
    await expect(repository.repositories.get("repo-1")).rejects.toMatchObject({
      name: "StorageError",
      code: "STORAGE_READ_FAILED",
    });
  });

  it("wraps S3 read and write failures as controlled storage errors", async () => {
    const artifacts = createS3ArtifactRepository({
      bucketName: "bucket",
      client: {
        send: async () => {
          throw new Error("s3 unavailable");
        },
      } as never,
    });
    await expect(artifacts.get("repositories/repo-1/raw/a.ts")).rejects.toMatchObject({
      code: "STORAGE_READ_FAILED",
    });
    await expect(artifacts.putSnapshot("repo-1", "v1", new Uint8Array([1]))).rejects.toMatchObject({
      code: "STORAGE_WRITE_FAILED",
    });
  });

  it("returns a controlled API error without leaking the storage failure", async () => {
    const service = createInvestigationService(
      { enqueue: () => undefined },
      {
        storage: {
          investigations: {
            get: async () => {
              throw new Error("dynamodb unavailable");
            },
            create: async () => undefined,
          } as never,
        },
      },
    );
    const router = createApiRouter({ service, auth: testAuth() });
    const response = await router(
      request("/api/investigations/00000000-0000-0000-0000-000000000000"),
    );
    expect(response?.status).toBe(500);
    const body = await response!.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("dynamodb unavailable");
  });
});

describe("worker failure handling", () => {
  async function harness(indexingStatus: "completed" | "running" = "completed") {
    const store = createInMemoryRepositoryStore();
    const artifacts = createInMemoryArtifactRepository();
    await store.repositories.create({
      repositoryId: "repo-1",
      userId: "user-1",
      owner: "acme",
      name: "payments",
      defaultBranch: "main",
      indexingStatus,
      snapshotVersion: "sha-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await store.issues.put({
      repositoryId: "repo-1",
      issueNumber: 42,
      title: "Payment timeout",
      state: "open",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await store.investigations.create({
      investigationId: "inv-1",
      repositoryId: "repo-1",
      issueNumber: 42,
      status: "queued",
      progress: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { entries, logger } = createCapturingLogger();
    return { store, artifacts, entries, logger };
  }

  const options = (
    state: Awaited<ReturnType<typeof harness>>,
    agent: never,
    extra: Record<string, unknown> = {},
  ) =>
    ({
      storage: state.store,
      artifacts: state.artifacts,
      github: {} as never,
      model: {} as never,
      logger: state.logger,
      agent,
      ...extra,
    }) as never;

  it("fails controlled when the repository is not indexed", async () => {
    const state = await harness("running");
    const worker = createInvestigationWorker(options(state, (async () => result) as never));
    await worker.handle({ investigationId: "inv-1" });
    expect(state.store.investigationsById.get("inv-1")).toMatchObject({
      status: "failed",
      failureCode: "REPOSITORY_NOT_INDEXED",
    });
  });

  it("fails controlled on a Bedrock error", async () => {
    const state = await harness();
    const worker = createInvestigationWorker(
      options(state, (async () => ({
        ...result,
        status: "failed",
        summary: "Bedrock returned no text content",
      })) as never),
    );
    await worker.handle({ investigationId: "inv-1" });
    expect(state.store.investigationsById.get("inv-1")).toMatchObject({
      status: "failed",
      failureCode: "BEDROCK_ERROR",
    });
  });

  it("records a timeout with a distinct state", async () => {
    const state = await harness();
    const worker = createInvestigationWorker(
      options(state, (async () => {
        throw new Error("Investigation timed out");
      }) as never),
    );
    await worker.handle({ investigationId: "inv-1" });
    expect(state.store.investigationsById.get("inv-1")).toMatchObject({
      status: "timeout",
      failureCode: "INVESTIGATION_TIMEOUT",
    });
  });

  it("retries bounded async dispatch without running the investigation twice", async () => {
    const state = await harness();
    let dispatches = 0;
    let agentRuns = 0;
    const worker = createInvestigationWorker(
      options(
        state,
        (async () => {
          agentRuns += 1;
          return result;
        }) as never,
        {
          maxAsyncAttempts: 3,
          invokeAsync: async () => {
            dispatches += 1;
            if (dispatches < 3) throw new Error("dispatch failed");
            await worker.handle({ investigationId: "inv-1" });
          },
        },
      ),
    );
    worker.enqueue({ investigationId: "inv-1" } as never);
    await waitFor(
      () => state.store.investigationsById.get("inv-1")?.status === "completed",
      "investigation completion",
    );
    expect(dispatches).toBe(3);
    expect(agentRuns).toBe(1);
    await worker.handle({ investigationId: "inv-1" });
    expect(agentRuns).toBe(1);
    expect(
      state.entries.filter((entry) => entry.message === "investigation_async_retry"),
    ).toHaveLength(2);
  });

  it("gives up after the bounded dispatch budget and logs the failure", async () => {
    const state = await harness();
    let dispatches = 0;
    const worker = createInvestigationWorker(
      options(state, (async () => result) as never, {
        maxAsyncAttempts: 1,
        invokeAsync: async () => {
          dispatches += 1;
          throw new Error("dispatch failed");
        },
      }),
    );
    worker.enqueue({ investigationId: "inv-1" } as never);
    await waitFor(
      () =>
        state.entries.some((entry) => entry.message === "investigation_async_invocation_failed"),
      "dispatch failure log",
    );
    expect(dispatches).toBe(1);
  });
});

describe("frontend network failure handling", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWindow;
  });

  function installBrowserGlobals(fetcher: typeof fetch) {
    (globalThis as { window?: unknown }).window = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };
    globalThis.fetch = fetcher;
  }

  it("maps an interrupted connection to a controlled client error", async () => {
    installBrowserGlobals((async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch);
    await expect(apiClient.listRepositories()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });

  it("maps an API error response to its code and message", async () => {
    installBrowserGlobals(
      (async () =>
        new Response(
          JSON.stringify({
            error: { code: "INVESTIGATION_NOT_FOUND", message: "Investigation was not found." },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    );
    await expect(
      apiClient.getInvestigation("00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({
      code: "INVESTIGATION_NOT_FOUND",
      status: 404,
    });
  });
});
