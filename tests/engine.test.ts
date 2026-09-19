import { describe, expect, it } from "vitest";
import { indexSourceFile } from "../src/retrieval";
import {
  createInvestigationTools,
  investigationLimits,
  resolveInvestigationLimits,
  runInvestigation,
  type ToolDependencies,
} from "../src/investigation/engine";
import type { GitHubClient } from "../src/github/types";
import type { RepositoryChunkRecord } from "../src/storage/types";

function setup() {
  const records: RepositoryChunkRecord[] = [];
  const bodies = new Map<string, Uint8Array>();
  const storage = {
    chunks: {
      put: async (record: RepositoryChunkRecord) => records.push(record),
      listForRepository: async (repositoryId: string) => ({
        items: records.filter((record) => record.repositoryId === repositoryId),
      }),
    },
  };
  const artifacts = {
    putChunk: async (_repositoryId: string, chunkId: string, body: Uint8Array) => {
      bodies.set(chunkId, body);
      return `chunk:${chunkId}`;
    },
    get: async (key: string) => bodies.get(key.replace("chunk:", "")) ?? new Uint8Array(),
  };
  const commit = {
    sha: "commit-a",
    commit: { message: "Fix payment timeout", author: { name: "Alex", date: "2026-01-01" } },
    html_url: "https://github.com/acme/payments/commit/commit-a",
  };
  const issue = {
    number: 42,
    title: "Payment timeout",
    state: "open" as const,
    user: { login: "alex" },
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    html_url: "https://github.com/acme/payments/issues/42",
  };
  const github = {
    getFile: async () =>
      new TextEncoder().encode(
        "await paymentProvider.request(); // timeout\nreturn acknowledge();",
      ),
    listCommits: async () => ({ items: [commit] }),
    getCommit: async () => commit,
    searchRelated: async () => ({ items: [issue] }),
  } as unknown as GitHubClient;
  const context = {
    repositoryId: "repo-a",
    owner: "acme",
    name: "payments",
    ref: "main",
    commitSha: "commit-a",
  };
  return { storage, artifacts, github, context, records };
}

describe("investigation engine", () => {
  it("validates tool inputs, preserves provenance, and blocks cross-repository access", async () => {
    const setupState = setup();
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
    const { tools } = createInvestigationTools(setupState as ToolDependencies);
    const result = await tools.searchRepository({
      repositoryId: "repo-a",
      query: "payment timeout",
    });
    expect(result.provenance[0]).toMatchObject({
      provenance: {
        repositoryId: "repo-a",
        filePath: "src/payment.ts",
        startLine: 1,
        commitSha: "commit-a",
      },
    });
    await expect(
      tools.searchRepository({ repositoryId: "repo-b", query: "payment" }),
    ).rejects.toThrow("Repository isolation");
    await expect(
      tools.buildEvidence({
        repositoryId: "repo-a",
        evidenceIds: ["missing"],
        claim: "unsupported",
      }),
    ).rejects.toThrow("did not resolve");
  });

  it("runs one bounded orchestrator and returns only resolved claims", async () => {
    const setupState = setup();
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
    const model = {
      converse: async (_system: string, prompt: string) => {
        if (prompt.includes("[PHASE:SYNTHESIZE]")) {
          const evidenceId = prompt.match(/file:[a-f0-9]+/)?.[0];
          return JSON.stringify({
            claims: [
              { text: "The handler waits before acknowledging.", evidenceIds: [evidenceId] },
            ],
          });
        }
        if (prompt.includes("[PHASE:HYPOTHESIZE]")) {
          const evidenceId = prompt.match(/file:[a-f0-9]+/)?.[0];
          return JSON.stringify({
            claims: [{ text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] }],
          });
        }
        return "{}";
      },
    };
    const result = await runInvestigation(
      {
        repositoryId: "repo-a",
        owner: "acme",
        name: "payments",
        ref: "main",
        commitSha: "commit-a",
        issueNumber: 42,
        issueTitle: "Payment timeout",
      },
      { ...setupState, model },
      { maxIterations: 1, maxToolCalls: 12, maxTokenBudget: 6000, timeoutMs: 5000 },
    );
    expect(result.status).toBe("completed");
    expect(result.claims[0]?.evidenceIds[0]).toBe(result.evidence[0]?.evidenceId);
    expect(result.evidence[0]?.provenance.repositoryId).toBe("repo-a");
  });

  it("returns a validated failed result when the call budget is exceeded", async () => {
    const setupState = setup();
    const result = await runInvestigation(
      {
        repositoryId: "repo-a",
        owner: "acme",
        name: "payments",
        ref: "main",
        commitSha: "commit-a",
        issueNumber: 42,
      },
      { ...setupState, model: { converse: async () => "{}" } },
      { maxToolCalls: 1, timeoutMs: 5000 },
    );
    expect(result).toMatchObject({
      repositoryId: "repo-a",
      issueNumber: 42,
      status: "failed",
      claims: [],
      evidence: [],
    });
  });
});
describe("bounded investigation limits", () => {
  it("uses the approved defaults and hard caps", () => {
    expect(resolveInvestigationLimits()).toEqual({
      maxIterations: 8,
      maxToolCalls: 20,
      maxRetrievedChunks: 24,
      maxTokenBudget: 6000,
      timeoutMs: 30000,
    });
    expect(investigationLimits).toEqual({
      maxIterations: { default: 8, minimum: 1, cap: 8 },
      maxToolCalls: { default: 20, minimum: 1, cap: 20 },
      maxRetrievedChunks: { default: 24, minimum: 1, cap: 24 },
      maxTokenBudget: { default: 6000, minimum: 256, cap: 6000 },
      timeoutMs: { default: 30000, minimum: 1000, cap: 30000 },
    });
  });

  it("clamps larger caller values to the hard caps", () => {
    expect(
      resolveInvestigationLimits({
        maxIterations: 999,
        maxToolCalls: 999,
        maxRetrievedChunks: 999,
        maxTokenBudget: 999_999,
        timeoutMs: 999_999,
      }),
    ).toEqual({
      maxIterations: 8,
      maxToolCalls: 20,
      maxRetrievedChunks: 24,
      maxTokenBudget: 6000,
      timeoutMs: 30000,
    });
  });

  it("preserves smaller caller values and raises values below the minimum", () => {
    expect(
      resolveInvestigationLimits({
        maxIterations: 2,
        maxToolCalls: 5,
        maxRetrievedChunks: 4,
        maxTokenBudget: 3000,
        timeoutMs: 5000,
      }),
    ).toEqual({
      maxIterations: 2,
      maxToolCalls: 5,
      maxRetrievedChunks: 4,
      maxTokenBudget: 3000,
      timeoutMs: 5000,
    });
    expect(resolveInvestigationLimits({ maxIterations: 0, timeoutMs: 1 })).toMatchObject({
      maxIterations: 1,
      timeoutMs: 1000,
    });
  });

  it("falls back to the defaults for missing or non-finite caller values", () => {
    expect(
      resolveInvestigationLimits({
        maxIterations: Number.NaN,
        maxTokenBudget: Number.POSITIVE_INFINITY,
        timeoutMs: Number.NEGATIVE_INFINITY,
      }),
    ).toMatchObject({ maxIterations: 8, maxTokenBudget: 6000, timeoutMs: 30000 });
  });
});
