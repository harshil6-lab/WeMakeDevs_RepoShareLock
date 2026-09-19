import { describe, expect, it } from "vitest";
import { createInvestigationWorker } from "../src/api/worker";
import type { InvestigationResult } from "../src/investigation/engine";
import type { InvestigationRecord, RepositoryStore } from "../src/storage/types";

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

function setup() {
  const record: InvestigationRecord = {
    investigationId: "inv-1",
    repositoryId: "repo-1",
    issueNumber: 42,
    status: "queued",
    progress: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const stages: string[] = [];
  const store = {
    investigations: {
      get: async () => record,
      create: async () => undefined,
      updateStatus: async () => undefined,
      claimQueued: async () => {
        if (record.status !== "queued") return false;
        record.status = "running";
        record.startedAt = "2026-01-01T00:00:01.000Z";
        return true;
      },
      updateProgress: async (_id: string, stage: typeof record.currentStage, progress: number) => {
        if (record.status !== "running") throw new Error("stale worker");
        record.currentStage = stage;
        record.progress = progress;
        stages.push(stage ?? "");
      },
      complete: async (_id: string, value: Record<string, unknown>) => {
        if (record.status !== "running") throw new Error("stale worker");
        record.status = "completed";
        record.currentStage = "completed";
        record.progress = 100;
        record.result = value;
      },
      fail: async (
        _id: string,
        status: "failed" | "timeout",
        failureCode: string,
        error: string,
      ) => {
        record.status = status;
        record.failureCode = failureCode;
        record.error = error;
      },
    },
    repositories: {
      get: async () => ({
        repositoryId: "repo-1",
        userId: "user-1",
        owner: "acme",
        name: "payments",
        defaultBranch: "main",
        indexingStatus: "completed" as const,
        snapshotVersion: "sha-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    },
    issues: {
      get: async () => ({
        repositoryId: "repo-1",
        issueNumber: 42,
        title: "Payment timeout",
        state: "open" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    },
  } as unknown as RepositoryStore;
  return { record, stages, store };
}

const baseOptions = (
  setupState: ReturnType<typeof setup>,
  agent: NonNullable<Parameters<typeof createInvestigationWorker>[0]["agent"]>,
) => ({
  storage: setupState.store,
  artifacts: {} as never,
  github: {} as never,
  model: {} as never,
  agent,
});

describe("investigation worker", () => {
  it("claims queued work, persists real stages, and completes with a validated result", async () => {
    const state = setup();
    const worker = createInvestigationWorker(
      baseOptions(state, async (_input, _dependencies, options) => {
        await options.onStageChange?.("understanding_issue");
        await options.onStageChange?.("validating");
        return result;
      }),
    );
    await worker.handle({ investigationId: "inv-1" });
    expect(state.record).toMatchObject({
      status: "completed",
      currentStage: "completed",
      progress: 100,
    });
    expect(state.stages).toEqual(["understanding_issue", "validating"]);
    expect(state.record.result).toEqual(result);
  });

  it("ignores duplicate events after the first worker claims the investigation", async () => {
    const state = setup();
    let executions = 0;
    const worker = createInvestigationWorker(
      baseOptions(state, async () => {
        executions += 1;
        return result;
      }),
    );
    await worker.handle({ investigationId: "inv-1" });
    await worker.handle({ investigationId: "inv-1" });
    expect(executions).toBe(1);
    expect(state.record.status).toBe("completed");
  });

  it("persists controlled failure and timeout states", async () => {
    const failed = setup();
    await createInvestigationWorker(
      baseOptions(failed, async () => ({ ...result, status: "failed" })),
    ).handle({ investigationId: "inv-1" });
    expect(failed.record).toMatchObject({ status: "failed", failureCode: "INVALID_AGENT_RESULT" });

    const timedOut = setup();
    await createInvestigationWorker(
      baseOptions(timedOut, async () => {
        throw new Error("Investigation timed out");
      }),
    ).handle({ investigationId: "inv-1" });
    expect(timedOut.record).toMatchObject({
      status: "timeout",
      failureCode: "INVESTIGATION_TIMEOUT",
    });
  });
});
