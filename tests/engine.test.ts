import { describe, expect, it } from "vitest";
import { indexSourceFile } from "../src/retrieval";
import { createBedrockModel } from "../src/investigation/bedrock";
import {
  claimsOutputContract,
  createInvestigationTools,
  investigationLimits,
  resolveInvestigationLimits,
  runInvestigation,
  synthesizeOutputContract,
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

function evidenceBackedModel(prompts: string[]) {
  return {
    converse: async (_system: string, prompt: string) => {
      prompts.push(prompt);
      if (prompt.includes("[PHASE:HYPOTHESIZE]") || prompt.includes("[PHASE:SYNTHESIZE]")) {
        const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
        return JSON.stringify({
          claims: [{ text: "The handler waits before acknowledging.", evidenceIds: [evidenceId] }],
        });
      }
      return "{}";
    },
  };
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

  it("accepts a direct HYPOTHESIZE claims envelope and returns only resolved claims", async () => {
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
          const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
          return JSON.stringify({
            claims: [
              { text: "The handler waits before acknowledging.", evidenceIds: [evidenceId] },
            ],
          });
        }
        if (prompt.includes("[PHASE:HYPOTHESIZE]")) {
          const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
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

  it("continues with an empty related-issue result without fabricating evidence", async () => {
    const setupState = setup();
    setupState.github.searchRelated = async () => ({ items: [] });
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
    const prompts: string[] = [];
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
      { ...setupState, model: evidenceBackedModel(prompts) },
      { maxIterations: 1, maxToolCalls: 12, maxTokenBudget: 6000, timeoutMs: 5000 },
    );
    expect(result.status).toBe("completed");
    expect(result.evidence.some((item) => item.provenance.type === "issue")).toBe(false);
    const hypothesisPrompt = prompts.find((prompt) => prompt.includes("[PHASE:HYPOTHESIZE]"));
    expect(hypothesisPrompt).toContain('"issues":[]');
  });

  it("continues with related issues and preserves their real evidence", async () => {
    const setupState = setup();
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
    const prompts: string[] = [];
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
      { ...setupState, model: evidenceBackedModel(prompts) },
      { maxIterations: 1, maxToolCalls: 12, maxTokenBudget: 6000, timeoutMs: 5000 },
    );
    expect(result.status).toBe("completed");
    expect(result.claims[0]?.evidenceIds[0]).toBe(result.evidence[0]?.evidenceId);
    expect(prompts.find((prompt) => prompt.includes("[PHASE:HYPOTHESIZE]"))).toContain(
      '"number":42',
    );
  });

  it("continues when related-issue search fails and records only failure context", async () => {
    const setupState = setup();
    setupState.github.searchRelated = async () => {
      throw new Error("GitHub related search unavailable");
    };
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
    const prompts: string[] = [];
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
      { ...setupState, model: evidenceBackedModel(prompts) },
      { maxIterations: 1, maxToolCalls: 12, maxTokenBudget: 6000, timeoutMs: 5000 },
    );
    expect(result.status).toBe("completed");
    expect(result.evidence.some((item) => item.provenance.type === "issue")).toBe(false);
    const hypothesisPrompt = prompts.find((prompt) => prompt.includes("[PHASE:HYPOTHESIZE]"));
    expect(hypothesisPrompt).toContain("relatedSearchError");
    expect(hypothesisPrompt).toContain("GitHub related search unavailable");
  });

  it("stops reporting stages once the timeout wins the race", async () => {
    const setupState = setup();
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
    const stages: string[] = [];
    // SYNTHESIZE is held open until after the bounded timeout fires, so the
    // continuation that used to keep running (and write progress) is released
    // late. This reproduces the production race where the abandoned run tried to
    // update a record the timeout path had already made terminal.
    let releaseSynthesize: (() => void) | undefined;
    const model = {
      converse: async (_system: string, prompt: string) => {
        if (prompt.includes("[PHASE:SYNTHESIZE]"))
          return new Promise<string>((resolve) => {
            const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
            releaseSynthesize = () =>
              resolve(
                JSON.stringify({ claims: [{ text: "Late claim", evidenceIds: [evidenceId] }] }),
              );
          });
        if (prompt.includes("[PHASE:HYPOTHESIZE]")) {
          const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
          return JSON.stringify({
            claims: [{ text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] }],
          });
        }
        return "{}";
      },
    };
    const pending = runInvestigation(
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
      {
        maxIterations: 1,
        maxToolCalls: 12,
        maxTokenBudget: 6000,
        timeoutMs: 1000,
        onStageChange: (stage) => {
          stages.push(stage);
        },
      },
    );
    while (releaseSynthesize === undefined) await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    releaseSynthesize();
    const result = await pending;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.status).toBe("failed");
    expect(result.summary).toMatch(/timed out/i);
    expect(stages).toContain("synthesizing");
    // The abandoned run must not report the stages that follow the timeout.
    expect(stages).not.toContain("validating");
    expect(stages).not.toContain("completed");
  });

  it("does not surface an unhandled rejection from a run abandoned by the timeout", async () => {
    const setupState = setup();
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      let failSynthesize: (() => void) | undefined;
      const model = {
        converse: async (_system: string, prompt: string) => {
          if (prompt.includes("[PHASE:SYNTHESIZE]"))
            return new Promise<string>((_resolve, reject) => {
              failSynthesize = () => reject(new Error("Bedrock failed after the timeout"));
            });
          if (prompt.includes("[PHASE:HYPOTHESIZE]")) {
            const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
            return JSON.stringify({
              claims: [
                { text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] },
              ],
            });
          }
          return "{}";
        },
      };
      const pending = runInvestigation(
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
        { maxIterations: 1, maxToolCalls: 12, maxTokenBudget: 6000, timeoutMs: 1000 },
      );
      while (failSynthesize === undefined) await new Promise((resolve) => setTimeout(resolve, 5));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      failSynthesize();
      const result = await pending;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(result.status).toBe("failed");
      expect(result.summary).toMatch(/timed out/i);
      expect(rejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
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

  it("states the claims contract in the prompt so the model returns claims", async () => {
    const setupState = setup();
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
    const prompts: string[] = [];
    // Reproduces the production failure: the model only emits the required
    // structure when the prompt states the contract. Without it the response was
    // {"hypothesis": ...} and validation failed with "claims: Required".
    const model = {
      converse: async (_system: string, prompt: string) => {
        prompts.push(prompt);
        if (!prompt.includes("[PHASE:HYPOTHESIZE]") && !prompt.includes("[PHASE:SYNTHESIZE]"))
          return "{}";
        if (!prompt.includes(claimsOutputContract))
          return JSON.stringify({ hypothesis: "The payment provider may be slow." });
        const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
        return JSON.stringify({
          claims: [{ text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] }],
        });
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
    expect(result.claims.length).toBeGreaterThan(0);

    const hypothesize = prompts.find((prompt) => prompt.includes("[PHASE:HYPOTHESIZE]"));
    expect(hypothesize).toContain(claimsOutputContract);
    expect(hypothesize).toMatch(/"claims"/);
    expect(hypothesize).toMatch(/evidenceIds/);
    // The contract is an instruction, so it is kept outside the data envelope.
    expect(hypothesize!.indexOf(claimsOutputContract)).toBeLessThan(
      hypothesize!.indexOf("<repository-data>"),
    );
    expect(prompts.find((prompt) => prompt.includes("[PHASE:SYNTHESIZE]"))).toContain(
      claimsOutputContract,
    );
  });

  it("still rejects a response that omits claims instead of accepting it", async () => {
    const setupState = setup();
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
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
      {
        ...setupState,
        model: {
          converse: async (_system: string, prompt: string) =>
            prompt.includes("[PHASE:HYPOTHESIZE]")
              ? JSON.stringify({ hypothesis: "The payment provider may be slow." })
              : JSON.stringify({ claims: [] }),
        },
      },
      { maxIterations: 1, maxToolCalls: 12, maxTokenBudget: 6000, timeoutMs: 5000 },
    );
    expect(result).toMatchObject({ status: "failed", claims: [], evidence: [] });
  });

  it("keeps HYPOTHESIZE claim evidence validation strict", async () => {
    const setupState = setup();
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
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
      {
        ...setupState,
        model: {
          converse: async (_system: string, prompt: string) => {
            if (prompt.includes("[PHASE:HYPOTHESIZE]"))
              return JSON.stringify({
                claims: [{ text: "Unsupported hypothesis", evidenceIds: [] }],
              });
            return JSON.stringify({ claims: [] });
          },
        },
      },
      { maxIterations: 1, maxToolCalls: 12, maxTokenBudget: 6000, timeoutMs: 5000 },
    );
    expect(result).toMatchObject({ status: "failed", claims: [], evidence: [] });
  });

  it("keeps the final evidence mapped to every synthesized claim", async () => {
    const setupState = setup();
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: "await paymentProvider.request(); // timeout\nreturn acknowledge();",
    });
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
      {
        ...setupState,
        model: {
          converse: async (_system: string, prompt: string) => {
            const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
            if (prompt.includes("[PHASE:HYPOTHESIZE]"))
              return JSON.stringify({
                claims: [{ text: "Hypothesis", evidenceIds: [evidenceId] }],
              });
            if (prompt.includes("[PHASE:SYNTHESIZE]"))
              return JSON.stringify({
                claims: [
                  { text: "First validated claim", evidenceIds: [evidenceId] },
                  { text: "Second validated claim", evidenceIds: [evidenceId] },
                ],
              });
            return "{}";
          },
        },
      },
      { maxIterations: 1, maxToolCalls: 12, maxTokenBudget: 6000, timeoutMs: 5000 },
    );
    expect(result.status).toBe("completed");
    expect(result.claims).toHaveLength(2);
    expect(result.evidence).toHaveLength(1);
    const evidenceIds = new Set(result.evidence.map((item) => item.evidenceId));
    for (const claim of result.claims)
      for (const id of claim.evidenceIds) expect(evidenceIds.has(id)).toBe(true);
  });
});

describe("synthesize output contract and JSON extraction", () => {
  const input = {
    repositoryId: "repo-a",
    owner: "acme",
    name: "payments",
    ref: "main",
    commitSha: "commit-a",
    issueNumber: 42,
    issueTitle: "Payment timeout",
  };
  const options = { maxIterations: 1, maxToolCalls: 12, maxTokenBudget: 6000, timeoutMs: 5000 };
  const fileContent = "await paymentProvider.request(); // timeout\nreturn acknowledge();";

  async function indexedSetup() {
    const setupState = setup();
    await indexSourceFile(setupState.storage, setupState.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "commit-a",
      content: fileContent,
    });
    return setupState;
  }

  it("tells the synthesizer to emit raw JSON with escaped quotes, without changing the HYPOTHESIZE contract", async () => {
    const setupState = await indexedSetup();
    const prompts: string[] = [];
    const result = await runInvestigation(
      input,
      {
        ...setupState,
        model: {
          converse: async (_system: string, prompt: string) => {
            prompts.push(prompt);
            const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
            if (prompt.includes("[PHASE:SYNTHESIZE]"))
              return JSON.stringify({
                claims: [
                  { text: "The handler waits before acknowledging.", evidenceIds: [evidenceId] },
                ],
              });
            if (prompt.includes("[PHASE:HYPOTHESIZE]"))
              return JSON.stringify({
                claims: [
                  { text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] },
                ],
              });
            return "{}";
          },
        },
      },
      options,
    );
    expect(result.status).toBe("completed");

    const synthesize = prompts.find((prompt) => prompt.includes("[PHASE:SYNTHESIZE]"));
    expect(synthesize).toContain(synthesizeOutputContract);
    expect(synthesize).toContain(claimsOutputContract);
    expect(synthesize).toMatch(/no markdown code fences/);
    expect(synthesize).toMatch(/escape/i);
    expect(synthesize).toMatch(/raw line break/);

    // The HYPOTHESIZE contract is untouched by this change.
    const hypothesize = prompts.find((prompt) => prompt.includes("[PHASE:HYPOTHESIZE]"));
    expect(hypothesize).toContain(claimsOutputContract);
    expect(hypothesize).not.toContain(synthesizeOutputContract);
  });

  it("rejects a claim text that breaks JSON instead of repairing it", async () => {
    const setupState = await indexedSetup();
    const result = await runInvestigation(
      input,
      {
        ...setupState,
        model: {
          converse: async (_system: string, prompt: string) => {
            const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
            if (prompt.includes("[PHASE:SYNTHESIZE]"))
              // The production failure mode: an unescaped quote inside an array
              // string, which JSON.parse rejects with
              // "Expected ',' or ']' after array element".
              return '{\n  "claims": [\n    {"text": "x", "evidenceIds": ["file:abc"def"]}\n  ]\n}';
            if (prompt.includes("[PHASE:HYPOTHESIZE]"))
              return JSON.stringify({
                claims: [
                  { text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] },
                ],
              });
            return "{}";
          },
        },
      },
      options,
    );
    expect(result).toMatchObject({ status: "failed", claims: [], evidence: [] });
  });

  it("still finds the answer when the model appends a note containing braces", async () => {
    const setupState = await indexedSetup();
    const result = await runInvestigation(
      input,
      {
        ...setupState,
        model: {
          converse: async (_system: string, prompt: string) => {
            const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
            if (prompt.includes("[PHASE:SYNTHESIZE]"))
              return `${JSON.stringify({
                claims: [
                  { text: "The handler waits before acknowledging.", evidenceIds: [evidenceId] },
                ],
              })}\n\nNote: keep {} and {"claims":[]} escaped.`;
            if (prompt.includes("[PHASE:HYPOTHESIZE]"))
              return JSON.stringify({
                claims: [
                  { text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] },
                ],
              });
            return "{}";
          },
        },
      },
      options,
    );
    expect(result.status).toBe("completed");
    expect(result.claims.length).toBeGreaterThan(0);
  });

  it("parses a synthesis envelope the model wrapped in another object", async () => {
    const setupState = await indexedSetup();
    const result = await runInvestigation(
      input,
      {
        ...setupState,
        model: {
          converse: async (_system: string, prompt: string) => {
            const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
            if (prompt.includes("[PHASE:SYNTHESIZE]"))
              // Production shape: the claims envelope is nested under a wrapper
              // object, so the first balanced object has no top-level `claims`
              // and parseModelJson reported claims: Required (undefined).
              return JSON.stringify({
                reasoning: "The handler waits for the provider before acking.",
                result: {
                  claims: [
                    { text: "The handler waits before acknowledging.", evidenceIds: [evidenceId] },
                  ],
                },
              });
            if (prompt.includes("[PHASE:HYPOTHESIZE]"))
              return JSON.stringify({
                claims: [
                  { text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] },
                ],
              });
            return "{}";
          },
        },
      },
      options,
    );
    expect(result.status).toBe("completed");
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.evidenceIds[0]).toBe(result.evidence[0]?.evidenceId);
  });

  it("parses a synthesis envelope preceded by a reasoning object", async () => {
    const setupState = await indexedSetup();
    const result = await runInvestigation(
      input,
      {
        ...setupState,
        model: {
          converse: async (_system: string, prompt: string) => {
            const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
            if (prompt.includes("[PHASE:SYNTHESIZE]"))
              // The first balanced object is reasoning, not the claims envelope.
              return (
                '{"note":"analysis only"}\n' +
                JSON.stringify({
                  claims: [
                    { text: "The handler waits before acknowledging.", evidenceIds: [evidenceId] },
                  ],
                })
              );
            if (prompt.includes("[PHASE:HYPOTHESIZE]"))
              return JSON.stringify({
                claims: [
                  { text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] },
                ],
              });
            return "{}";
          },
        },
      },
      options,
    );
    expect(result.status).toBe("completed");
    expect(result.claims).toHaveLength(1);
  });

  it("parses a synthesis envelope the model double-encoded as a string", async () => {
    const setupState = await indexedSetup();
    const result = await runInvestigation(
      input,
      {
        ...setupState,
        model: {
          converse: async (_system: string, prompt: string) => {
            const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
            if (prompt.includes("[PHASE:SYNTHESIZE]"))
              return JSON.stringify({
                output: JSON.stringify({
                  claims: [
                    { text: "The handler waits before acknowledging.", evidenceIds: [evidenceId] },
                  ],
                }),
              });
            if (prompt.includes("[PHASE:HYPOTHESIZE]"))
              return JSON.stringify({
                claims: [
                  { text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] },
                ],
              });
            return "{}";
          },
        },
      },
      options,
    );
    expect(result.status).toBe("completed");
    expect(result.claims).toHaveLength(1);
  });

  it("recovers the claims envelope from a later Converse content block", async () => {
    const setupState = await indexedSetup();
    // The real application boundary: createBedrockModel receives the Converse
    // response whose message.content is an ordered ContentBlock[]. The first
    // block carries reasoning JSON without `claims`; the envelope is in a later
    // block. The adapter must forward every block, not just the first.
    const client = {
      send: async (command: {
        input: { messages?: Array<{ content?: Array<{ text?: string }> }> };
      }) => {
        const prompt = command.input.messages?.[0]?.content?.[0]?.text ?? "";
        const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
        if (prompt.includes("[PHASE:SYNTHESIZE]"))
          return {
            output: {
              message: {
                content: [
                  { text: JSON.stringify({ analysis: "The handler awaits the provider." }) },
                  {
                    text: JSON.stringify({
                      claims: [
                        {
                          text: "The handler waits before acknowledging.",
                          evidenceIds: [evidenceId],
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          };
        if (prompt.includes("[PHASE:HYPOTHESIZE]"))
          return {
            output: {
              message: {
                content: [
                  { text: JSON.stringify({ analysis: "The handler awaits the provider." }) },
                  {
                    text: JSON.stringify({
                      claims: [
                        {
                          text: "The handler may delay acknowledgement.",
                          evidenceIds: [evidenceId],
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          };
        return { output: { message: { content: [{ text: "{}" }] } } };
      },
    };
    const model = createBedrockModel({ modelId: "test.model-v1", client: client as never });
    const result = await runInvestigation(input, { ...setupState, model }, options);
    expect(result.status).toBe("completed");
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.evidenceIds[0]).toBe(result.evidence[0]?.evidenceId);
  });
  it("still rejects a synthesis response whose objects never carry claims", async () => {
    const setupState = await indexedSetup();
    const result = await runInvestigation(
      input,
      {
        ...setupState,
        model: {
          converse: async (_system: string, prompt: string) => {
            const evidenceId = prompt.match(/file:[^"\s]*:\d+-\d+/)?.[0];
            if (prompt.includes("[PHASE:SYNTHESIZE]"))
              return JSON.stringify({ analysis: "The provider is slow." });
            if (prompt.includes("[PHASE:HYPOTHESIZE]"))
              return JSON.stringify({
                claims: [
                  { text: "The handler may delay acknowledgement.", evidenceIds: [evidenceId] },
                ],
              });
            return "{}";
          },
        },
      },
      options,
    );
    expect(result).toMatchObject({ status: "failed", claims: [], evidence: [] });
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
