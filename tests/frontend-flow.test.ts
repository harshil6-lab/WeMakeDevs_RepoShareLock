import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConfiguredApiRouter, type ApiRequestHandler } from "../src/api/composition";
import { apiClient } from "../src/api/client";
import {
  resultEvidence,
  resultSummary,
  toEvidenceView,
  toIssueView,
  toRepositoryView,
} from "../src/components/reposherlock/api-models";
import {
  goldenCommits,
  goldenExpectations,
  goldenFileByPath,
  goldenRepositoryFixture,
} from "./fixtures/golden-repository.fixture";
import { createGoldenGitHubClient } from "./golden/golden-github-client";
import { createRecordingBedrockModel } from "./golden/golden-model";
import {
  createInMemoryArtifactRepository,
  createInMemoryRepositoryStore,
  type GoldenStore,
} from "./golden/in-memory-store";
import { testAuth } from "./helpers/auth";

const canonicalStages = [
  "understanding_issue",
  "searching_repository",
  "tracing_code",
  "checking_history",
  "finding_related_issues",
  "forming_hypothesis",
  "verifying_evidence",
  "synthesizing",
  "validating",
  "completed",
];

type EvidenceJson = {
  evidenceId: string;
  excerpt: string;
  provenance: { type: string; repositoryId: string } & Record<string, unknown>;
};

async function pollUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  label: string,
  attempts = 2000,
): Promise<T[]> {
  const seen: T[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    seen.push(value);
    if (done(value)) return seen;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(label + " did not reach a terminal state");
}

function lineCount(content: string): number {
  return content.replace(/\r\n/g, "\n").split("\n").length;
}

describe("frontend golden flow (real API client and view models)", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  let store: GoldenStore;

  beforeEach(() => {
    store = createInMemoryRepositoryStore();
    const artifacts = createInMemoryArtifactRepository();
    const router: ApiRequestHandler | undefined = createConfiguredApiRouter(
      {},
      {
        storage: store,
        artifacts,
        github: createGoldenGitHubClient(),
        model: createRecordingBedrockModel(),
        userId: "golden-user",
        auth: testAuth("golden-user"),
      },
    );
    if (!router) throw new Error("composition root did not configure the golden harness");
    (globalThis as { window?: unknown }).window = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), "http://localhost"), init);
      const response = await router(request);
      if (!response) throw new Error("router returned no response for " + String(input));
      return response;
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("drives login, repository, issue, investigate, progress, result, WHY, code and history", async () => {
    // 1. Login.
    expect(await apiClient.getSession()).toMatchObject({ authenticated: true });

    // 2. Repository.
    const created = await apiClient.createRepository({
      owner: goldenRepositoryFixture.owner,
      name: goldenRepositoryFixture.name,
    });
    expect(created.name).toBe(goldenRepositoryFixture.name);
    const repositories = await apiClient.listRepositories();
    expect(repositories).toHaveLength(1);
    const repositoryView = toRepositoryView(repositories[0]!);
    expect(repositoryView.repositoryId).toBe(goldenExpectations.repositoryId);
    const repositoryId = repositoryView.repositoryId;

    // 3. Index and wait for completion.
    await apiClient.startIndexing(repositoryId);
    const indexStates = await pollUntil(
      () => apiClient.getIndexStatus(repositoryId),
      (state) => state.status === "completed" || state.status === "failed",
      "indexing",
    );
    expect(indexStates.at(-1)).toMatchObject({ status: "completed", progress: 100 });

    // 4. Issue.
    const issues = await apiClient.listIssues(repositoryId);
    expect(issues.map((issue) => issue.issueNumber)).toContain(goldenExpectations.issueNumber);
    const issue = await apiClient.getIssue(repositoryId, goldenExpectations.issueNumber);
    const issueView = toIssueView(issue);
    expect(issueView).toMatchObject({ number: 1842, title: goldenExpectations.issueTitle });

    // 5. Investigate: the HTTP call returns a queued handle before the run finishes.
    const started = await apiClient.createInvestigation(
      repositoryId,
      goldenExpectations.issueNumber,
    );
    expect(started.status).toBe("queued");
    expect(store.investigationsById.get(started.investigationId)?.status).not.toBe("completed");

    // 6. Progress.
    const statusReads = await pollUntil(
      () => apiClient.getInvestigationStatus(started.investigationId),
      (state) => ["completed", "failed", "timeout"].includes(state.status),
      "investigation",
    );
    const transitions = statusReads
      .map((state) => state.status)
      .filter((value, index, values) => index === 0 || values[index - 1] !== value);
    expect(transitions).toEqual(["queued", "running", "completed"]);
    const progressValues = statusReads.map((state) => state.progress ?? 0);
    expect(progressValues.at(-1)).toBe(100);
    expect(progressValues).toEqual([...progressValues].sort((left, right) => left - right));
    for (const state of statusReads) {
      if (state.currentStage) expect(canonicalStages).toContain(state.currentStage);
    }

    // 7. Result.
    const investigation = await apiClient.getInvestigation(started.investigationId);
    expect(investigation.status).toBe("completed");
    expect(resultSummary(investigation).length).toBeGreaterThan(0);
    const evidence = (investigation.result?.["evidence"] ?? []) as unknown as EvidenceJson[];
    expect(evidence.length).toBeGreaterThanOrEqual(3);
    expect(resultEvidence(investigation)).toHaveLength(evidence.length);

    // 8. WHY: the evidence endpoint returns the same resolved items.
    const why = await apiClient.listEvidence(started.investigationId);
    expect(why.map((item) => item.evidenceId).sort()).toEqual(
      evidence.map((item) => item.evidenceId).sort(),
    );
    for (const view of why.map(toEvidenceView)) {
      expect(view.excerpt.length).toBeGreaterThan(0);
      expect(canonicalStages).toContain("completed");
    }

    // 9. Code and history provenance resolves against the golden dataset.
    for (const item of evidence) {
      expect(item.provenance.repositoryId).toBe(goldenExpectations.repositoryId);
      if (item.provenance.type === "repository_file" || item.provenance.type === "documentation") {
        const file = goldenFileByPath.get(String(item.provenance["filePath"]));
        expect(file, "fabricated file path " + String(item.provenance["filePath"])).toBeDefined();
        expect(Number(item.provenance["endLine"])).toBeLessThanOrEqual(lineCount(file!.content));
      }
      if (item.provenance.type === "commit")
        expect(goldenCommits.some((commit) => commit.sha === item.provenance["commitSha"])).toBe(
          true,
        );
      if (item.provenance.type === "pull_request")
        expect(Number(item.provenance["issueNumber"])).toBe(goldenExpectations.relatedPullRequest);
    }
    const fileEvidence = evidence.filter(
      (item) => item.provenance["filePath"] === goldenExpectations.relevantFile,
    );
    expect(fileEvidence.length).toBeGreaterThanOrEqual(1);
    expect(
      fileEvidence.some((item) => item.excerpt.includes(goldenExpectations.relevantFunction)),
    ).toBe(true);
    expect(
      evidence
        .filter((item) => item.provenance.type === "commit")
        .map((item) => item.provenance["commitSha"]),
    ).toContain(goldenExpectations.relevantCommitSha);

    // 10. Impact and fix plan are not part of the result contract: they stay absent
    // rather than being fabricated.
    expect(investigation.result?.["impact"]).toBeUndefined();
    expect(investigation.result?.["fixPlan"]).toBeUndefined();
  });
});
