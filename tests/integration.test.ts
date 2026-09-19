import { describe, expect, it } from "vitest";
import { createApiRouter } from "../src/api/router";
import { createInvestigationService } from "../src/api/service";
import { createRepositoryResourceService } from "../src/api/resources";
import { createInvestigationWorker } from "../src/api/worker";
import { ingestRepository } from "../src/github/ingestion";
import { retrieve } from "../src/retrieval";
import { runInvestigation } from "../src/investigation/engine";
import { s3Keys } from "../src/storage/keys";
import type { InvestigationResult } from "../src/investigation/engine";
import { goldenExpectations, goldenRepositoryFixture } from "./fixtures/golden-repository.fixture";
import { createGoldenGitHubClient } from "./golden/golden-github-client";
import { createRecordingBedrockModel } from "./golden/golden-model";
import {
  createInMemoryArtifactRepository,
  createInMemoryRepositoryStore,
} from "./golden/in-memory-store";

const request = (url: string, init?: RequestInit) => new Request("http://localhost" + url, init);

describe("API to repository store integration", () => {
  it("persists a queued investigation and serves its lifecycle from storage", async () => {
    const store = createInMemoryRepositoryStore();
    const service = createInvestigationService({ enqueue: () => undefined }, { storage: store });
    const router = createApiRouter({ service });
    const created = await router(
      request("/api/investigations", {
        method: "POST",
        body: JSON.stringify({ repositoryId: "repo-1", issueNumber: 42 }),
      }),
    );
    expect(created?.status).toBe(202);
    const body = await created!.json();
    const record = store.investigationsById.get(body.investigationId);
    expect(record).toMatchObject({
      repositoryId: "repo-1",
      issueNumber: 42,
      status: "queued",
      progress: 0,
    });
    const status = await router(request("/api/investigations/" + body.investigationId + "/status"));
    expect(await status!.json()).toMatchObject({
      investigationId: body.investigationId,
      status: "queued",
      progress: 0,
    });
    const detail = await router(request("/api/investigations/" + body.investigationId));
    expect(await detail!.json()).toMatchObject({
      investigationId: body.investigationId,
      repositoryId: "repo-1",
      issueNumber: 42,
    });
  });
});

describe("API to GitHub integration", () => {
  it("resolves real repository metadata through GitHub and persists it", async () => {
    const store = createInMemoryRepositoryStore();
    const github = createGoldenGitHubClient();
    const resources = createRepositoryResourceService({ storage: store, userId: "user-1", github });
    const router = createApiRouter({ resources });
    const created = await router(
      request("/api/repositories", {
        method: "POST",
        body: JSON.stringify({
          owner: goldenRepositoryFixture.owner,
          name: goldenRepositoryFixture.name,
        }),
      }),
    );
    expect(created?.status).toBe(201);
    const repositoryId = goldenExpectations.repositoryId;
    const persisted = await store.repositories.get(repositoryId);
    expect(persisted).toMatchObject({
      repositoryId,
      owner: goldenRepositoryFixture.owner,
      name: goldenRepositoryFixture.name,
      indexingStatus: "not_started",
    });
    const listed = await router(request("/api/repositories"));
    expect(
      (await listed!.json()).items.map((item: { repositoryId: string }) => item.repositoryId),
    ).toEqual([repositoryId]);
  });
});

describe("ingestion, retrieval and investigation integration", () => {
  async function ingestGolden() {
    const store = createInMemoryRepositoryStore();
    const artifacts = createInMemoryArtifactRepository();
    const github = createGoldenGitHubClient();
    const outcome = await ingestRepository(github, store, artifacts, {
      userId: "user-1",
      owner: goldenRepositoryFixture.owner,
      name: goldenRepositoryFixture.name,
    });
    return { store, artifacts, github, outcome };
  }

  it("stores the snapshot, raw source and metadata for an indexed repository", async () => {
    const { store, artifacts, outcome } = await ingestGolden();
    expect(outcome).toMatchObject({
      repositoryId: goldenExpectations.repositoryId,
      filesStored: 5,
      issuesStored: 2,
    });
    const repositoryId = outcome.repositoryId;
    expect(artifacts.objects.has(s3Keys.snapshot(repositoryId, outcome.snapshotVersion))).toBe(
      true,
    );
    expect(
      artifacts.objects.has(s3Keys.rawArtifact(repositoryId, goldenExpectations.relevantFile)),
    ).toBe(true);
    expect(store.filesStored).toHaveLength(5);
    expect(store.commitsStored).toHaveLength(3);
    expect(
      store.filesStored.some((file) => file.filePath === goldenExpectations.relevantFile),
    ).toBe(true);
    const issue = await store.issues.get(repositoryId, goldenExpectations.issueNumber);
    expect(issue?.title).toBe(goldenExpectations.issueTitle);
    expect(
      await store.issues.get(repositoryId, goldenExpectations.relatedPullRequest),
    ).toBeUndefined();
  });

  it("retrieves indexed chunks with resolvable provenance", async () => {
    const { store, artifacts, outcome } = await ingestGolden();
    const results = await retrieve(
      outcome.repositoryId,
      goldenExpectations.issueTitle,
      store,
      artifacts,
    );
    expect(results.length).toBeGreaterThan(0);
    const relevant = results.find((result) => result.filePath === goldenExpectations.relevantFile);
    expect(relevant).toBeDefined();
    expect(relevant!.commitSha).toBeTruthy();
    expect(relevant!.startLine).toBeGreaterThanOrEqual(1);
    expect(relevant!.endLine).toBeGreaterThanOrEqual(relevant!.startLine);
  });

  it("runs the agent against the indexed repository with bounded Bedrock prompts", async () => {
    const { store, artifacts, github, outcome } = await ingestGolden();
    const model = createRecordingBedrockModel();
    const repositoryId = outcome.repositoryId;
    const context = {
      repositoryId,
      owner: goldenRepositoryFixture.owner,
      name: goldenRepositoryFixture.name,
      ref: outcome.snapshotVersion,
      commitSha: outcome.snapshotVersion,
    };
    const result = await runInvestigation(
      {
        ...context,
        issueNumber: goldenExpectations.issueNumber,
        issueTitle: goldenExpectations.issueTitle,
      },
      { github, storage: store, artifacts, context, model },
      { maxIterations: 1, timeoutMs: 5000 },
    );
    expect(result.status).toBe("completed");
    expect(result.repositoryId).toBe(repositoryId);
    const phases = model.calls.map((call) => call.phase);
    expect(phases).toEqual(
      expect.arrayContaining(["PLAN", "ANALYZE", "HYPOTHESIZE", "SYNTHESIZE"]),
    );
    expect(model.calls.every((call) => call.maxTokens > 0 && call.maxTokens <= 1200)).toBe(true);
  });

  it("persists a completed investigation through the worker", async () => {
    const { store, artifacts, github } = await ingestGolden();
    const model = createRecordingBedrockModel();
    const repositoryId = goldenExpectations.repositoryId;
    await store.investigations.create({
      investigationId: "inv-golden",
      repositoryId,
      issueNumber: goldenExpectations.issueNumber,
      status: "queued",
      progress: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const worker = createInvestigationWorker({ storage: store, artifacts, github, model });
    await worker.handle({ investigationId: "inv-golden" });
    const record = store.investigationsById.get("inv-golden");
    expect(record).toMatchObject({
      status: "completed",
      currentStage: "completed",
      progress: 100,
    });
    expect(record?.result).toBeDefined();
    expect(typeof record?.durationMs).toBe("number");
    expect(record?.completedAt).toBeDefined();
    const persisted = record?.result as unknown as InvestigationResult;
    expect(persisted.evidence.length).toBeGreaterThan(0);
  });
});
