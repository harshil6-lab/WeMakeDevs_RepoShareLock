import { randomUUID } from "node:crypto";
import { loadConfig, type ApiConfig } from "./config";
import { errorResponse, NotFoundError } from "./errors";
import { createLogger, type StructuredLogger } from "./logger";
import {
  createInvestigationRequestSchema,
  createInvestigationResponseSchema,
  healthResponseSchema,
  investigationSchema,
} from "./schemas";
import { createInvestigationService, type InvestigationService } from "./service";
import { createMockInvestigationWorker, type InvestigationWorker } from "./worker";
import type { RepositoryStore } from "../storage/types";
import type { RepositoryResourceService } from "./resources";

export type ApiRouterOptions = {
  config?: ApiConfig;
  logger?: StructuredLogger;
  service?: InvestigationService;
  storage?: Pick<RepositoryStore, "investigations">;
  worker?: InvestigationWorker;
  resources?: RepositoryResourceService;
};

export function createApiRouter(options: ApiRouterOptions = {}) {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config);
  const service =
    options.service ??
    createInvestigationService(
      options.worker ?? createMockInvestigationWorker(),
      options.storage ? { storage: options.storage } : {},
    );

  return async function handleApiRequest(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return undefined;
    const requestId = randomUUID();
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return Response.json(
          healthResponseSchema.parse({
            status: "ok",
            service: config.serviceName,
            version: config.apiVersion,
          }),
        );
      }
      if (options.resources && url.pathname === "/api/auth/session" && request.method === "POST")
        return Response.json({ authenticated: true }, { headers: { "x-request-id": requestId } });
      if (options.resources && url.pathname === "/api/repositories" && request.method === "GET")
        return Response.json(
          { items: await options.resources.listRepositories() },
          { headers: { "x-request-id": requestId } },
        );
      if (options.resources && url.pathname === "/api/repositories" && request.method === "POST")
        return Response.json(await options.resources.createRepository(await request.json()), {
          status: 201,
          headers: { "x-request-id": requestId },
        });
      const repositoryMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)$/);
      if (options.resources && repositoryMatch && request.method === "GET")
        return Response.json(await options.resources.getRepository(repositoryMatch[1]!), {
          headers: { "x-request-id": requestId },
        });
      const indexMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/index$/);
      if (options.resources && indexMatch && request.method === "POST")
        return Response.json(await options.resources.startIndex(indexMatch[1]!), {
          status: 202,
          headers: { "x-request-id": requestId },
        });
      const indexStatusMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/index-status$/);
      if (options.resources && indexStatusMatch && request.method === "GET")
        return Response.json(await options.resources.getIndexStatus(indexStatusMatch[1]!), {
          headers: { "x-request-id": requestId },
        });
      const issuesMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/issues$/);
      if (options.resources && issuesMatch && request.method === "GET")
        return Response.json(
          { items: await options.resources.listIssues(issuesMatch[1]!) },
          { headers: { "x-request-id": requestId } },
        );
      const issueMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/issues\/(\d+)$/);
      if (options.resources && issueMatch && request.method === "GET")
        return Response.json(
          await options.resources.getIssue(issueMatch[1]!, Number(issueMatch[2])),
          { headers: { "x-request-id": requestId } },
        );
      if (url.pathname === "/api/investigations" && request.method === "POST") {
        const input = createInvestigationRequestSchema.parse(await request.json());
        const investigation = await service.create(input);
        const response = createInvestigationResponseSchema.parse({
          investigationId: investigation.investigationId,
          status: investigation.status,
        });
        logger.info("investigation_queued", {
          requestId,
          investigationId: investigation.investigationId,
        });
        return Response.json(response, { status: 202, headers: { "x-request-id": requestId } });
      }
      const statusMatch = url.pathname.match(/^\/api\/investigations\/([^/]+)\/status$/);
      if (statusMatch && request.method === "GET") {
        const investigation = await service.get(statusMatch[1]!);
        return Response.json(
          investigationSchema
            .pick({
              investigationId: true,
              status: true,
              currentStage: true,
              progress: true,
              updatedAt: true,
              failureCode: true,
            })
            .parse(investigation),
          { headers: { "x-request-id": requestId } },
        );
      }
      const match = url.pathname.match(/^\/api\/investigations\/([^/]+)$/);
      if (match && request.method === "GET") {
        return Response.json(investigationSchema.parse(await service.get(match[1]!)), {
          headers: { "x-request-id": requestId },
        });
      }
      const evidenceMatch = url.pathname.match(/^\/api\/investigations\/([^/]+)\/evidence$/);
      if (options.resources && evidenceMatch && request.method === "GET")
        return Response.json(
          { items: await options.resources.listEvidence(evidenceMatch[1]!) },
          { headers: { "x-request-id": requestId } },
        );
      return errorResponse(new NotFoundError(), requestId);
    } catch (error) {
      logger.error("api_request_failed", {
        requestId,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResponse(error, requestId);
    }
  };
}
