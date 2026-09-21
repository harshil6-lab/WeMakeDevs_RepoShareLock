import { describe, expect, it } from "vitest";
import { createConfiguredApiRouter, type ApiRequestHandler } from "../../src/api/composition";
import type { StructuredLogger } from "../../src/api/logger";
import { ingestRepository } from "../../src/github/ingestion";
import { retrieve } from "../../src/retrieval";
import {
  resultEvidence,
  resultSummary,
  toEvidenceView,
  toIssueView,
} from "../../src/components/reposherlock/api-models";
import {
  goldenCommits,
  goldenExpectations,
  goldenFileByPath,
  goldenIssueDetail,
  goldenObjectIds,
  goldenRelatedPullRequest,
  goldenRepositoryFixture,
} from "../fixtures/golden-repository.fixture";
import { createGoldenGitHubClient } from "./golden-github-client";
import { createInMemoryArtifactRepository, createInMemoryRepositoryStore } from "./in-memory-store";
import { createRecordingBedrockModel } from "./golden-model";
import { testAuth } from "../helpers/auth";

const goldenUserId = "golden-user";

/** Canonical order of the single orchestrator's stage callbacks. */
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
] as const;

/** The only tools the bounded agent is allowed to execute. */
const approvedTools = [
  "searchRepository",
  "readFile",
  "searchGitHistory",
  "getCommit",
  "searchRelatedIssues",
  "buildEvidence",
];

type EvidenceJson = {
  evidenceId: string;
  excerpt: string;
  provenance: { type: string; repositoryId: string } & Record<string, unknown>;
};

type ClaimJson = { text: string; evidenceIds: string[] };

/** Response shape of the investigation endpoints, as the frontend sees it. */
type InvestigationJson = {
  investigationId: string;
  repositoryId: string;
  issueNumber: number;
  status: "queued" | "running" | "completed" | "failed" | "timeout";
  updatedAt: string;
  currentStage?: string;
  progress?: number;
  failureCode?: string;
  durationMs?: number;
  result?: {
    status?: string;
    summary?: string;
    claims?: ClaimJson[];
    evidence?: EvidenceJson[];
  } & Record<string, unknown>;
};

type CapturedLog = { level: string; message: string; context: Record<string, unknown> };

const request = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);

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

async function createHarness() {
  const store = createInMemoryRepositoryStore();
  const artifacts = createInMemoryArtifactRepository();
  const github = createGoldenGitHubClient();
  const model = createRecordingBedrockModel();
  const { entries, logger } = createCapturingLogger();
  const router = createConfiguredApiRouter(
    {},
    {
      storage: store,
      artifacts,
      github,
      model,
      logger,
      userId: goldenUserId,
      auth: testAuth(goldenUserId),
    },
  );
  if (!router) throw new Error("The composition root did not configure the golden harness");
  return { store, artifacts, github, model, logger, logs: entries, router };
}

async function readJson<T>(response: Response | undefined, label: string): Promise<T> {
  if (!response) throw new Error(`${label} returned no response`);
  return (await response.json()) as T;
}

async function pollUntil<T>(
  read: () => Promise<T>,
  isDone: (value: T) => boolean,
  label: string,
  attempts = 1000,
): Promise<T[]> {
  const seen: T[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    seen.push(value);
    if (isDone(value)) return seen;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`${label} did not reach a terminal state`);
}

function lineCount(content: string): number {
  return content.replace(/\r\n/g, "\n").split("\n").length;
}

/**
 * Asserts a single evidence locator resolves against the golden dataset.
 * Any path, sha, issue number or line range that does not exist fails here.
 */
function expectLocatorResolves(evidence: EvidenceJson): void {
  const provenance = evidence.provenance;
  expect(provenance.repositoryId).toBe(goldenExpectations.repositoryId);
  if (provenance.type === "repository_file" || provenance.type === "documentation") {
    const filePath = String(provenance["filePath"]);
    const file = goldenFileByPath.get(filePath);
    expect(file, `fabricated file path: ${filePath}`).toBeDefined();
    const startLine = Number(provenance["startLine"]);
    const endLine = Number(provenance["endLine"]);
    expect(startLine).toBeGreaterThanOrEqual(1);
    expect(endLine).toBeGreaterThanOrEqual(startLine);
    expect(endLine).toBeLessThanOrEqual(lineCount(file!.content));
    expect(goldenObjectIds.has(String(provenance["commitSha"])), "fabricated sha").toBe(true);
    const excerpt = evidence.excerpt.replace(/\r\n/g, "\n");
    const probe = excerpt.length > 4000 ? excerpt.slice(0, 2000) : excerpt;
    expect(file!.content.replace(/\r\n/g, "\n")).toContain(probe);
  } else if (provenance.type === "commit") {
    expect(goldenObjectIds.has(String(provenance["commitSha"])), "fabricated commit").toBe(true);
  } else {
    const issueNumber = Number(provenance["issueNumber"]);
    expect(
      [goldenIssueDetail.number, goldenRelatedPullRequest.number, 1837],
      `fabricated issue/PR: ${issueNumber}`,
    ).toContain(issueNumber);
  }
}

describe("golden end-to-end investigation", () => {
  it("ranks the implicated implementation file first for the golden issue", async () => {
    const { store, artifacts, github } = await createHarness();
    await ingestRepository(github, store, artifacts, {
      userId: goldenUserId,
      owner: goldenRepositoryFixture.owner,
      name: goldenRepositoryFixture.name,
    });
    const results = await retrieve(
      goldenExpectations.repositoryId,
      goldenExpectations.issueTitle,
      store,
      artifacts,
    );
    expect(results[0]?.filePath).toBe(goldenExpectations.relevantFile);
    expect(results[0]?.content).toContain(goldenExpectations.relevantFunction);
    expect(results.every((result) => result.repositoryId === goldenExpectations.repositoryId)).toBe(
      true,
    );
  });

  it("runs USER to FRONTEND to API to INDEX to AGENT to BEDROCK to EVIDENCE to FRONTEND", async () => {
    const harness = await createHarness();
    const { router, store, model, logs } = harness;

    // 1. Authenticate.
    const session = await router(request("/api/auth/session", { method: "GET" }));
    expect(session?.status).toBe(200);
    expect(await readJson<{ authenticated: boolean }>(session, "session")).toMatchObject({
      authenticated: true,
    });

    // 2. Select the golden repository (connect it, then list it like the UI does).
    const connected = await router(
      request("/api/repositories", {
        method: "POST",
        body: JSON.stringify({
          owner: goldenRepositoryFixture.owner,
          name: goldenRepositoryFixture.name,
        }),
      }),
    );
    expect(connected?.status).toBe(201);
    const repositoryId = goldenExpectations.repositoryId;
    const listed = await readJson<{ items: Array<{ repositoryId: string }> }>(
      await router(request("/api/repositories")),
      "repositories",
    );
    expect(listed.items.map((item) => item.repositoryId)).toEqual([repositoryId]);

    // 3. Index the repository and wait for the real ingestion to finish.
    const indexStart = await router(
      request(`/api/repositories/${repositoryId}/index`, { method: "POST", body: "{}" }),
    );
    expect(indexStart?.status).toBe(202);
    const indexStates = await pollUntil(
      async () =>
        readJson<{ status: string; progress?: number }>(
          await router(request(`/api/repositories/${repositoryId}/index-status`)),
          "index status",
        ),
      (state) => state.status === "completed" || state.status === "failed",
      "indexing",
    );
    expect(indexStates.at(-1)).toMatchObject({ status: "completed", progress: 100 });
    const indexed = await store.repositories.get(repositoryId);
    expect(indexed?.indexingStatus).toBe("completed");
    expect(goldenObjectIds.has(String(indexed?.snapshotVersion))).toBe(true);

    // 4. Retrieve real issues. Pull requests must not be stored as issues.
    const issues = await readJson<{
      items: Array<{ issueNumber: number; title: string; state: string }>;
    }>(await router(request(`/api/repositories/${repositoryId}/issues`)), "issues");
    const issueNumbers = issues.items.map((issue) => issue.issueNumber);
    expect(issueNumbers).toContain(goldenIssueDetail.number);
    expect(issueNumbers).not.toContain(goldenRelatedPullRequest.number);

    // 5. Select issue #1842 and confirm the frontend view model.
    const issue = await readJson<{ issueNumber: number; title: string }>(
      await router(request(`/api/repositories/${repositoryId}/issues/1842`)),
      "issue",
    );
    expect(issue.title).toBe(goldenExpectations.issueTitle);
    const issueView = toIssueView({ number: issue.issueNumber, title: issue.title, state: "open" });
    expect(issueView).toMatchObject({ number: 1842, title: goldenExpectations.issueTitle });

    // 6. Click INVESTIGATE.
    const created = await router(
      request("/api/investigations", {
        method: "POST",
        body: JSON.stringify({ repositoryId, issueNumber: goldenIssueDetail.number }),
      }),
    );
    expect(created?.status).toBe(202);
    const { investigationId, status } = await readJson<{
      investigationId: string;
      status: string;
    }>(created, "create investigation");
    expect(status).toBe("queued");

    // 7. Verify status transitions while the worker runs.
    const statusReads = await pollUntil(
      async () =>
        readJson<InvestigationJson>(
          await router(request(`/api/investigations/${investigationId}/status`)),
          "investigation status",
        ),
      (state) =>
        state.status === "completed" || state.status === "failed" || state.status === "timeout",
      "investigation status",
    );
    // The observable lifecycle is queued -> running (with stages) -> completed.
    const observedStatuses = statusReads
      .map((state) => state.status)
      .filter((value, index, values) => index === 0 || values[index - 1] !== value);
    expect(observedStatuses).toEqual(["queued", "running", "completed"]);
    expect(statusReads.at(-1)?.status).toBe("completed");
    const progressValues = statusReads.map((state) => state.progress ?? 0);
    expect(progressValues.at(-1)).toBe(100);
    expect(progressValues).toEqual([...progressValues].sort((left, right) => left - right));
    const observedStages = statusReads
      .map((state) => state.currentStage)
      .filter((stage): stage is string => Boolean(stage));
    const observedStageIndexes = observedStages.map((stage) =>
      canonicalStages.indexOf(stage as never),
    );
    expect(observedStageIndexes.length).toBeGreaterThanOrEqual(3);
    expect(observedStageIndexes).toEqual(
      [...observedStageIndexes].sort((left, right) => left - right),
    );

    // Stages are also observable from structured logs, which is deterministic.
    const loggedStages = logs
      .filter((entry) => entry.message === "investigation_stage_updated")
      .map((entry) => String(entry.context["stage"]));
    expect(loggedStages).toEqual([...canonicalStages]);
    expect(observedStages.every((stage) => canonicalStages.includes(stage as never))).toBe(true);

    // 8. Verify the agent executed only bounded, approved tools.
    const toolCalls = logs.filter((entry) => entry.message === "investigation_tool_call");
    expect(toolCalls.length).toBeGreaterThanOrEqual(5);
    expect(toolCalls.length).toBeLessThanOrEqual(20);
    const toolNames = toolCalls.map((entry) => String(entry.context["toolName"]));
    // One bounded pass: search, read, history, commit, related issues, then the
    // evidence builds required by synthesis. Never a second unbounded loop.
    expect(toolNames.slice(0, 5)).toEqual([
      "searchRepository",
      "readFile",
      "searchGitHistory",
      "getCommit",
      "searchRelatedIssues",
    ]);
    expect(toolNames.slice(5).every((name) => name === "buildEvidence")).toBe(true);
    for (const call of toolCalls) {
      expect(approvedTools).toContain(call.context["toolName"]);
      expect(typeof call.context["durationMs"]).toBe("number");
      expect(call.context["success"]).toBe(true);
    }

    // 9. Verify Bedrock was called for every reasoning phase.
    const phases = model.calls.map((call) => call.phase);
    expect(phases).toEqual(
      expect.arrayContaining(["PLAN", "ANALYZE", "HYPOTHESIZE", "SYNTHESIZE"]),
    );
    expect(model.phaseCount("SYNTHESIZE")).toBe(1);
    expect(model.calls.every((call) => call.maxTokens > 0)).toBe(true);
    expect(logs.filter((entry) => entry.message === "investigation_bedrock_call").length).toBe(
      model.calls.length,
    );

    // 10-11. Evidence was generated and validated before persistence.
    const investigation = await readJson<InvestigationJson>(
      await router(request(`/api/investigations/${investigationId}`)),
      "investigation",
    );
    expect(investigation.status).toBe("completed");
    expect(investigation.repositoryId).toBe(repositoryId);
    expect(investigation.issueNumber).toBe(goldenIssueDetail.number);
    expect(investigation.failureCode).toBeUndefined();
    const result = investigation.result;
    expect(result?.status).toBe("completed");
    const claims = result?.claims ?? [];
    const evidence = result?.evidence ?? [];
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(evidence.length).toBeGreaterThanOrEqual(3);
    expect(evidence.map((item) => item.provenance.type).sort()).toEqual([
      "commit",
      "pull_request",
      "repository_file",
    ]);
    const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
    expect(evidenceIds.size).toBe(evidence.length);
    for (const claim of claims) {
      expect(claim.evidenceIds.length).toBeGreaterThanOrEqual(1);
      for (const id of claim.evidenceIds) expect(evidenceIds.has(id)).toBe(true);
    }

    // 12. The investigation is persisted with a validated result.
    const persisted = store.investigationsById.get(investigationId);
    expect(persisted).toMatchObject({
      status: "completed",
      currentStage: "completed",
      progress: 100,
    });
    expect(persisted?.result).toBeDefined();
    expect(typeof persisted?.durationMs).toBe("number");
    expect(persisted?.completedAt).toBeDefined();

    // 13-14. The frontend receives the result and WHY can display its evidence.
    const summary = resultSummary(investigation);
    expect(summary.length).toBeGreaterThan(0);
    const evidenceViews = resultEvidence(investigation);
    expect(evidenceViews.length).toBe(evidence.length);
    const why = await readJson<{ items: EvidenceJson[] }>(
      await router(request(`/api/investigations/${investigationId}/evidence`)),
      "evidence",
    );
    expect(why.items.map((item) => item.evidenceId).sort()).toEqual([...evidenceIds].sort());
    for (const view of why.items.map(toEvidenceView)) {
      expect(view.excerpt.length).toBeGreaterThan(0);
      expect(evidenceViews.map((candidate) => candidate.id)).toContain(view.id);
    }

    // 15. The relevant code and file appear, and every locator resolves.
    for (const item of evidence) expectLocatorResolves(item);
    const fileEvidence = evidence.filter(
      (item) =>
        item.provenance.type === "repository_file" &&
        item.provenance["filePath"] === goldenExpectations.relevantFile,
    );
    expect(fileEvidence.length).toBeGreaterThanOrEqual(1);
    const codeEvidence = fileEvidence.find((item) =>
      goldenExpectations.relevantCodeSignals.every((signal) => item.excerpt.includes(signal)),
    );
    expect(codeEvidence, "resolved code evidence for the implicated file").toBeDefined();
    expect(
      fileEvidence.some((item) => {
        const source = goldenFileByPath.get(goldenExpectations.relevantFile)!;
        const startLine = Number(item.provenance["startLine"]);
        const endLine = Number(item.provenance["endLine"]);
        const lines = source.content.replace(/\r\n/g, "\n").split("\n");
        return lines
          .slice(startLine - 1, endLine)
          .join("\n")
          .includes(goldenExpectations.relevantFunction);
      }),
    ).toBe(true);

    // 16. History appears with the commit that introduced the blocking call.
    const commitEvidence = evidence.filter((item) => item.provenance.type === "commit");
    expect(commitEvidence.map((item) => item.provenance["commitSha"])).toContain(
      goldenExpectations.relevantCommitSha,
    );
    expect(store.commitsStored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repositoryId,
          commitSha: goldenExpectations.relevantCommitSha,
          message: goldenExpectations.relevantCommitMessage,
        }),
      ]),
    );
    expect(
      commitEvidence.some((item) =>
        goldenCommits.some(
          (commit) =>
            commit.sha === item.provenance["commitSha"] && item.excerpt.includes("provider"),
        ),
      ),
    ).toBe(true);

    // Related issues/PRs come from GitHub search, never from the model.
    expect(evidence.map((item) => item.provenance.type)).toContain("pull_request");
    expect(
      evidence.some(
        (item) => Number(item.provenance["issueNumber"]) === goldenExpectations.relatedPullRequest,
      ),
    ).toBe(true);

    // Root cause is supported by evidence: the claim cites resolved evidence and
    // semantically describes the synchronous pre-acknowledgement provider call.
    const rootCauseClaim = claims[0]!;
    const claimText = rootCauseClaim.text.toLowerCase();
    expect(claimText).toContain("provider");
    expect(claimText).toMatch(/acknowledge/);
    expect(claimText).toContain("timeout");
    expect(
      rootCauseClaim.evidenceIds.some(
        (id) =>
          evidenceIds.has(id) &&
          evidence.some(
            (item) =>
              item.evidenceId === id &&
              item.provenance["filePath"] === goldenExpectations.relevantFile,
          ),
      ),
    ).toBe(true);

    // 17-18. Impact and fix plan are not implemented in the result contract, so
    // the honest behaviour is absence, never a fabricated section.
    expect(result?.["impact"]).toBeUndefined();
    expect(result?.["fixPlan"]).toBeUndefined();

    // No log line may leak credentials.
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toMatch(/bearer/i);
    expect(serializedLogs).not.toMatch(/github_token|aws_secret|secretaccesskey/i);
    for (const entry of logs.filter((log) => log.message === "investigation_tool_call")) {
      expect(entry.context["investigationId"]).toBe(investigationId);
      expect(entry.context["repositoryId"]).toBe(repositoryId);
      expect(entry.context["issueNumber"]).toBe(goldenIssueDetail.number);
    }
    const completionLog = logs.find((entry) => entry.message === "investigation_completed");
    expect(completionLog?.context).toMatchObject({
      investigationId,
      repositoryId,
      issueNumber: goldenIssueDetail.number,
      status: "completed",
    });
    expect(typeof completionLog?.context["durationMs"]).toBe("number");
  });

  it("keeps the API unconfigured rather than serving half of the golden path", () => {
    expect(createConfiguredApiRouter({})).toBeUndefined();
  });
});
