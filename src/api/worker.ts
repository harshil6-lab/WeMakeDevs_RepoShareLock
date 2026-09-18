import {
  runInvestigation,
  type InvestigationEngineOptions,
  type InvestigationStage,
} from "../investigation/engine";
import type { BedrockModel } from "../investigation/bedrock";
import type { GitHubClient } from "../github/types";
import type { ArtifactRepository } from "../storage/s3-repository";
import type { InvestigationRecord, RepositoryStore } from "../storage/types";
import type { StructuredLogger } from "./logger";
import type { Investigation } from "./schemas";

export type InvestigationWorkerEvent = { investigationId: string };
export type InvestigationWorker = {
  enqueue: (investigation: Investigation) => void;
  handle: (event: InvestigationWorkerEvent) => Promise<void>;
};

export type InvestigationWorkerOptions = {
  storage: RepositoryStore;
  artifacts: ArtifactRepository;
  github: GitHubClient;
  model: BedrockModel;
  invokeAsync?: (event: InvestigationWorkerEvent) => Promise<void> | void;
  logger?: StructuredLogger;
  agent?: (
    input: Parameters<typeof runInvestigation>[0],
    dependencies: Parameters<typeof runInvestigation>[1],
    options: InvestigationEngineOptions,
  ) => Promise<Awaited<ReturnType<typeof runInvestigation>>>;
  agentOptions?: Omit<InvestigationEngineOptions, "onStageChange">;
};

class WorkerFailure extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkerFailure";
  }
}

const safeError = "Investigation could not be completed.";

function stageProgress(stage: InvestigationStage): number {
  return {
    understanding_issue: 10,
    searching_repository: 20,
    tracing_code: 35,
    checking_history: 50,
    finding_related_issues: 60,
    forming_hypothesis: 70,
    verifying_evidence: 80,
    synthesizing: 90,
    validating: 95,
    completed: 100,
  }[stage];
}

function failureCode(error: unknown): string {
  if (error instanceof WorkerFailure) return error.code;
  if (error instanceof Error && error.message.toLowerCase().includes("timed out"))
    return "INVESTIGATION_TIMEOUT";
  if (error instanceof Error && error.message.toLowerCase().includes("bedrock"))
    return "BEDROCK_ERROR";
  if (error instanceof Error && error.message.toLowerCase().includes("evidence"))
    return "EVIDENCE_VALIDATION_FAILED";
  return "INTERNAL_ERROR";
}

function agentFailureCode(summary: string): string {
  const normalized = summary.toLowerCase();
  if (normalized.includes("timed out")) return "INVESTIGATION_TIMEOUT";
  if (normalized.includes("bedrock")) return "BEDROCK_ERROR";
  if (normalized.includes("evidence")) return "EVIDENCE_VALIDATION_FAILED";
  return "INVALID_AGENT_RESULT";
}

function repositoryContext(
  record: InvestigationRecord,
  repository: NonNullable<Awaited<ReturnType<RepositoryStore["repositories"]["get"]>>>,
) {
  if (repository.indexingStatus !== "completed")
    throw new WorkerFailure("REPOSITORY_NOT_INDEXED", "Repository is not indexed");
  if (!repository.snapshotVersion)
    throw new WorkerFailure("REPOSITORY_NOT_INDEXED", "Repository snapshot is unavailable");
  return {
    repositoryId: record.repositoryId,
    owner: repository.owner,
    name: repository.name,
    ref: repository.snapshotVersion,
    commitSha: repository.snapshotVersion,
  };
}

export function createInvestigationWorker(
  options: InvestigationWorkerOptions,
): InvestigationWorker {
  const agent = options.agent ?? runInvestigation;
  const worker: InvestigationWorker = {
    enqueue(investigation) {
      const invokeAsync =
        options.invokeAsync ??
        ((event: InvestigationWorkerEvent) => {
          const handle: (nextEvent: InvestigationWorkerEvent) => Promise<void> = worker.handle;
          setTimeout(() => void handle(event), 0);
        });
      void Promise.resolve(invokeAsync({ investigationId: investigation.investigationId })).catch(
        (error: unknown) => {
          options.logger?.error("investigation_async_invocation_failed", {
            investigationId: investigation.investigationId,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
    },
    async handle(event) {
      const record = await options.storage.investigations.get(event.investigationId);
      if (!record)
        throw new WorkerFailure("INVESTIGATION_NOT_FOUND", "Investigation was not found");
      const startedAt = new Date().toISOString();
      const claimed = await options.storage.investigations.claimQueued(
        record.investigationId,
        startedAt,
        startedAt,
      );
      if (!claimed) return;
      const startedMs = Date.now();
      options.logger?.info("investigation_started", {
        investigationId: record.investigationId,
        repositoryId: record.repositoryId,
        issueNumber: record.issueNumber,
        stage: "understanding_issue",
      });
      const updateStage = async (stage: InvestigationStage) => {
        await options.storage.investigations.updateProgress(
          record.investigationId,
          stage,
          stageProgress(stage),
          new Date().toISOString(),
        );
        options.logger?.info("investigation_stage_updated", {
          investigationId: record.investigationId,
          repositoryId: record.repositoryId,
          issueNumber: record.issueNumber,
          stage,
          progress: stageProgress(stage),
        });
      };
      try {
        const repository = await options.storage.repositories.get(record.repositoryId);
        if (!repository)
          throw new WorkerFailure("REPOSITORY_NOT_FOUND", "Repository was not found");
        const issue = await options.storage.issues.get(record.repositoryId, record.issueNumber);
        if (!issue) throw new WorkerFailure("ISSUE_NOT_FOUND", "Issue was not found");
        const context = repositoryContext(record, repository);
        const result = await agent(
          { ...context, issueNumber: record.issueNumber, issueTitle: issue.title },
          {
            github: options.github,
            storage: options.storage,
            artifacts: options.artifacts,
            context,
            model: options.model,
          },
          {
            ...options.agentOptions,
            investigationId: record.investigationId,
            ...(options.logger === undefined ? {} : { logger: options.logger }),
            onStageChange: updateStage,
          },
        );
        if (result.status !== "completed" || result.evidence.length === 0)
          throw new WorkerFailure(
            agentFailureCode(result.summary),
            "Agent did not return a completed evidence-backed result",
          );
        const completedAt = new Date().toISOString();
        await options.storage.investigations.complete(
          record.investigationId,
          result,
          completedAt,
          Date.now() - startedMs,
          completedAt,
        );
        options.logger?.info("investigation_completed", {
          investigationId: record.investigationId,
          repositoryId: record.repositoryId,
          issueNumber: record.issueNumber,
          status: "completed",
          durationMs: Date.now() - startedMs,
        });
      } catch (error) {
        const code = failureCode(error);
        const status = code === "INVESTIGATION_TIMEOUT" ? "timeout" : "failed";
        const completedAt = new Date().toISOString();
        await options.storage.investigations.fail(
          record.investigationId,
          status,
          code,
          safeError,
          completedAt,
          Date.now() - startedMs,
          completedAt,
        );
        options.logger?.error("investigation_failed", {
          investigationId: record.investigationId,
          repositoryId: record.repositoryId,
          issueNumber: record.issueNumber,
          status,
          errorCode: code,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedMs,
        });
      }
    },
  };
  return worker;
}

export function createMockInvestigationWorker(): InvestigationWorker {
  return { enqueue: () => undefined, handle: async () => undefined };
}
