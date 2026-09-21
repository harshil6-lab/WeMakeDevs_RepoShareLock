import { randomUUID } from "node:crypto";
import { ApiError } from "./errors";
import type { InvestigationWorker } from "./worker";
import type { CreateInvestigationRequest, Investigation, InvestigationStatus } from "./schemas";
import type { InvestigationRecord, RepositoryStore } from "../storage/types";

export type InvestigationService = {
  create: (userId: string, request: CreateInvestigationRequest) => Promise<Investigation>;
  get: (userId: string, investigationId: string) => Promise<Investigation>;
};

export type InvestigationServiceOptions = {
  storage?: Pick<RepositoryStore, "investigations">;
};

type InvestigationEnqueuer = Pick<InvestigationWorker, "enqueue">;

function fromRecord(record: InvestigationRecord): Investigation {
  return {
    investigationId: record.investigationId,
    repositoryId: record.repositoryId,
    issueNumber: record.issueNumber,
    status: record.status,
    ...(record.currentStage === undefined ? {} : { currentStage: record.currentStage }),
    ...(record.progress === undefined ? {} : { progress: record.progress }),
    createdAt: record.createdAt,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt }),
    updatedAt: record.updatedAt,
    ...(record.result === undefined ? {} : { result: record.result }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.failureCode === undefined ? {} : { failureCode: record.failureCode }),
    ...(record.durationMs === undefined ? {} : { durationMs: record.durationMs }),
  };
}

export function createInvestigationService(
  worker: InvestigationEnqueuer,
  options: InvestigationServiceOptions = {},
): InvestigationService {
  const investigations = new Map<string, Investigation>();
  const owners = new Map<string, string>();

  return {
    async create(userId, request) {
      const now = new Date().toISOString();
      const investigation: Investigation = {
        investigationId: randomUUID(),
        repositoryId: request.repositoryId,
        issueNumber: request.issueNumber,
        status: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      };
      if (options.storage)
        await options.storage.investigations.create({
          investigationId: investigation.investigationId,
          userId,
          repositoryId: investigation.repositoryId,
          issueNumber: investigation.issueNumber,
          status: investigation.status,
          ...(investigation.progress === undefined ? {} : { progress: investigation.progress }),
          createdAt: investigation.createdAt,
          updatedAt: investigation.updatedAt,
        });
      investigations.set(investigation.investigationId, investigation);
      owners.set(investigation.investigationId, userId);
      // The dispatch call itself is awaited so a serverless runtime cannot
      // freeze before the asynchronous invoke is accepted. The investigation
      // still runs outside this request, so HTTP latency stays independent of
      // the agent pipeline.
      await Promise.resolve(worker.enqueue(investigation)).catch(() => undefined);
      return investigation;
    },
    async get(userId, investigationId) {
      if (options.storage) {
        const record = await options.storage.investigations.get(investigationId);
        if (record) {
          // Ownership is part of the lookup: a request for somebody else's
          // investigation is indistinguishable from an unknown id.
          if (record.userId !== userId)
            throw new ApiError(404, "INVESTIGATION_NOT_FOUND", "Investigation was not found.");
          return fromRecord(record);
        }
      }
      const investigation = investigations.get(investigationId);
      if (!investigation || owners.get(investigationId) !== userId)
        throw new ApiError(404, "INVESTIGATION_NOT_FOUND", "Investigation was not found.");
      return investigation;
    },
  };
}

export function updateInvestigationStatus(
  investigation: Investigation,
  status: InvestigationStatus,
): Investigation {
  return { ...investigation, status, updatedAt: new Date().toISOString() };
}
