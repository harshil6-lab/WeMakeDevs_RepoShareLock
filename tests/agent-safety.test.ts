import { describe, expect, it } from "vitest";
import { indexSourceFile } from "../src/retrieval";
import { runInvestigation } from "../src/investigation/engine";
import type { GitHubClient } from "../src/github/types";
import type { StructuredLogger } from "../src/api/logger";
import type { BedrockModel } from "../src/investigation/bedrock";

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

function createStorage() {
  const records: import("../src/storage/types").RepositoryChunkRecord[] = [];
  const bodies = new Map<string, Uint8Array>();
  const storage = {
    chunks: {
      put: async (record: import("../src/storage/types").RepositoryChunkRecord) => {
        records.push(record);
      },
      listForRepository: async (repositoryId: string) => ({
        items: records.filter((record) => record.repositoryId === repositoryId),
      }),
    },
  };
  const artifacts = {
    putChunk: async (_repositoryId: string, chunkId: string, body: Uint8Array) => {
      bodies.set(chunkId, body);
      return "chunk:" + chunkId;
    },
    get: async (key: string) => bodies.get(key.replace("chunk:", "")) ?? new Uint8Array(),
  };
  return { storage, artifacts, records };
}

function createGithub(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getFile: async () =>
      new TextEncoder().encode(
        "await paymentProvider.request(); // timeout\nreturn acknowledge();",
      ),
    listCommits: async () => ({ items: [commit] }),
    getCommit: async () => commit,
    searchRelated: async () => ({ items: [issue] }),
    ...overrides,
  } as unknown as GitHubClient;
}

const context = {
  repositoryId: "repo-a",
  owner: "acme",
  name: "payments",
  ref: "main",
  commitSha: "commit-a",
};

const input = {
  repositoryId: "repo-a",
  owner: "acme",
  name: "payments",
  ref: "main",
  commitSha: "commit-a",
  issueNumber: 42,
  issueTitle: "Payment timeout",
};

/** Model that cites a real evidence id found in the prompt unless overridden. */
function createModel(overrides: { synthesize?: string } = {}): BedrockModel {
  return {
    converse: async (_system: string, prompt: string) => {
      const id = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0] ?? "file:missing";
      if (prompt.includes("[PHASE:SYNTHESIZE]")) {
        if (overrides.synthesize !== undefined) return overrides.synthesize;
        return JSON.stringify({
          claims: [{ text: "The handler waits before acknowledging.", evidenceIds: [id] }],
        });
      }
      if (prompt.includes("[PHASE:HYPOTHESIZE]"))
        return JSON.stringify({
          claims: [{ text: "The handler may delay acknowledgement.", evidenceIds: [id] }],
        });
      return "{}";
    },
  };
}

async function indexFixture() {
  const state = createStorage();
  await indexSourceFile(state.storage, state.artifacts, {
    repositoryId: "repo-a",
    filePath: "src/payment.ts",
    commitSha: "commit-a",
    content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
  });
  return state;
}

describe("agent safety bounds", () => {
  it("caps retrieval to maxRetrievedChunks and terminates after a bounded pass", async () => {
    const state = await indexFixture();
    const { entries, logger } = createCapturingLogger();
    const result = await runInvestigation(
      input,
      { ...state, github: createGithub(), context, model: createModel() },
      { maxIterations: 8, maxRetrievedChunks: 1, maxToolCalls: 20, logger },
    );
    expect(result.status).toBe("completed");
    const toolCalls = entries.filter((entry) => entry.message === "investigation_tool_call");
    expect(
      toolCalls.filter((entry) => entry.context["toolName"] === "searchRepository"),
    ).toHaveLength(1);
    expect(toolCalls.length).toBeLessThanOrEqual(20);
  });

  it("stops with a validated failure when the tool budget is exhausted", async () => {
    const state = await indexFixture();
    const result = await runInvestigation(
      input,
      { ...state, github: createGithub(), context, model: createModel() },
      { maxToolCalls: 1, timeoutMs: 5000 },
    );
    expect(result).toMatchObject({ status: "failed", claims: [], evidence: [] });
    expect(result.summary).toMatch(/tool calls/i);
  });

  it("stops with a validated failure when the token budget is exhausted", async () => {
    const state = await indexFixture();
    const result = await runInvestigation(
      input,
      { ...state, github: createGithub(), context, model: createModel() },
      { maxTokenBudget: 256, timeoutMs: 5000 },
    );
    expect(result).toMatchObject({ status: "failed", evidence: [] });
    expect(result.summary).toMatch(/token budget/i);
  });

  it("terminates with a validated failure when Bedrock never responds", async () => {
    const state = await indexFixture();
    const result = await runInvestigation(
      input,
      {
        ...state,
        github: createGithub(),
        context,
        model: { converse: () => new Promise<string>(() => undefined) },
      },
      { timeoutMs: 1000 },
    );
    expect(result).toMatchObject({ status: "failed", evidence: [] });
    expect(result.summary).toMatch(/timed out/i);
  });

  it("terminates with a validated failure when a tool throws", async () => {
    const state = await indexFixture();
    const result = await runInvestigation(
      input,
      {
        ...state,
        github: createGithub({
          getFile: async () => {
            throw new Error("GitHub contents request failed");
          },
        }),
        context,
        model: createModel(),
      },
      { timeoutMs: 5000 },
    );
    expect(result).toMatchObject({ status: "failed", evidence: [] });
  });

  it("returns a controlled failure on malformed model output", async () => {
    const state = await indexFixture();
    const result = await runInvestigation(
      input,
      { ...state, github: createGithub(), context, model: createModel({ synthesize: "not json" }) },
      { timeoutMs: 5000 },
    );
    expect(result).toMatchObject({ status: "failed", evidence: [] });
    expect(result.summary).toMatch(/JSON/i);
  });

  it("rejects fabricated evidence references and returns no evidence", async () => {
    const state = await indexFixture();
    const result = await runInvestigation(
      input,
      {
        ...state,
        github: createGithub(),
        context,
        model: createModel({
          synthesize: JSON.stringify({
            claims: [{ text: "Fabricated root cause.", evidenceIds: ["file:deadbeef"] }],
          }),
        }),
      },
      { timeoutMs: 5000 },
    );
    expect(result).toMatchObject({ status: "failed", claims: [], evidence: [] });
    expect(result.summary).toMatch(/resolve/i);
  });

  it("resolves a retrieved chunk cited by the locator in its provenance", async () => {
    // Regression: retrieval evidence used to be keyed by an opaque
    // `file:<chunkId>` hash while the model could only reproduce the
    // `file:<filePath>:<startLine>-<endLine>` locator shown in provenance, so a
    // valid-looking citation failed `buildEvidence` with
    // EVIDENCE_VALIDATION_FAILED.
    const state = await indexFixture();
    const record = state.records[0]!;
    const locator = `file:${record.filePath}:${record.startLine}-${record.endLine}`;
    const result = await runInvestigation(
      input,
      {
        ...state,
        github: createGithub(),
        context,
        model: createModel({
          synthesize: JSON.stringify({
            claims: [{ text: "The webhook awaits the provider.", evidenceIds: [locator] }],
          }),
        }),
      },
      { timeoutMs: 5000 },
    );
    expect(result.status).toBe("completed");
    expect(result.claims[0]?.evidenceIds).toEqual([locator]);
    expect(result.evidence[0]?.evidenceId).toBe(locator);
  });

  it("deduplicates shared citations while preserving every validated claim", async () => {
    const state = await indexFixture();
    const record = state.records[0]!;
    const realId = `file:${record.filePath}:${record.startLine}-${record.endLine}`;
    const result = await runInvestigation(
      input,
      {
        ...state,
        github: createGithub(),
        context,
        model: createModel({
          synthesize: JSON.stringify({
            claims: [
              { text: "First claim.", evidenceIds: [realId] },
              { text: "Second claim.", evidenceIds: [realId] },
            ],
          }),
        }),
      },
      { timeoutMs: 5000 },
    );
    expect(result.status).toBe("completed");
    expect(result.claims).toHaveLength(2);
    expect(result.claims.every((claim) => claim.evidenceIds.includes(realId))).toBe(true);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.evidenceId).toBe(realId);
  });

  it("returns an empty, validated failure when retrieval and history are empty", async () => {
    const state = createStorage();
    const result = await runInvestigation(
      input,
      {
        ...state,
        github: createGithub({
          listCommits: async () => ({ items: [] }),
          searchRelated: async () => ({ items: [] }),
        }),
        context,
        model: createModel(),
      },
      { timeoutMs: 5000 },
    );
    expect(result).toMatchObject({ status: "failed", claims: [], evidence: [] });
    expect(result.evidence).toHaveLength(0);
  });
});
