import { randomUUID } from "node:crypto";
import { loadConfig, type ApiConfig } from "./config";
import {
  ApiError,
  AuthNotConfiguredError,
  errorResponse,
  NotFoundError,
  UnauthorizedError,
} from "./errors";
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
import type { AuthContext } from "../auth/server";
import type { AuthenticatedUser } from "../auth/identity";

export type ApiRouterOptions = {
  config?: ApiConfig;
  logger?: StructuredLogger;
  service?: InvestigationService;
  storage?: Pick<RepositoryStore, "investigations">;
  worker?: InvestigationWorker;
  resources?: RepositoryResourceService;
  /** Verified identity boundary; absent only in tests that inject their own. */
  auth?: AuthContext;
};

function redirect(location: string, setCookie: string[]): Response {
  const headers = new Headers({ location });
  for (const value of setCookie) headers.append("set-cookie", value);
  return new Response(null, { status: 302, headers });
}

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
    const respond = (body: unknown, status = 200): Response =>
      Response.json(body as Record<string, unknown>, {
        status,
        headers: { "x-request-id": requestId },
      });

    /** Resolves the verified user or fails the request; never trusts input. */
    const requireUser = async (): Promise<AuthenticatedUser> => {
      if (!options.auth?.configured) throw new AuthNotConfiguredError();
      const user = await options.auth.getUser(request);
      if (!user) throw new UnauthorizedError();
      return user;
    };

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

      // --- authentication -------------------------------------------------
      const authFlowMatch = url.pathname.match(/^\/api\/auth\/(login|signup|forgot-password)$/);
      if (authFlowMatch && request.method === "GET") {
        const auth = options.auth;
        if (!auth?.configured) throw new AuthNotConfiguredError();
        const flow =
          authFlowMatch[1] === "signup"
            ? ("signup" as const)
            : authFlowMatch[1] === "forgot-password"
              ? ("forgot_password" as const)
              : ("signin" as const);
        const loginHint = url.searchParams.get("login_hint") ?? undefined;
        const start = auth.startLogin({ flow, ...(loginHint ? { loginHint } : {}) });
        return redirect(start.location, start.setCookie);
      }
      if (url.pathname === "/api/auth/session" && request.method === "GET") {
        const auth = options.auth;
        // Cognito redirects here with `?code=`; the exchange sets the session.
        if (url.searchParams.has("code")) {
          if (!auth?.configured) throw new AuthNotConfiguredError();
          const completion = await auth.completeLogin(request);
          if (!completion.ok)
            throw new ApiError(completion.status, completion.code, completion.message);
          logger.info("auth_session_established", { requestId, userId: completion.user.userId });
          return redirect("/", completion.setCookie);
        }
        const user = await auth?.getUser(request);
        return respond({
          authenticated: Boolean(user),
          configured: Boolean(auth?.configured),
          user: user ? { userId: user.userId, ...(user.email ? { email: user.email } : {}) } : null,
        });
      }
      if (url.pathname === "/api/auth/session" && request.method === "POST") {
        // A session can only be reported, never invented: without a verified
        // token this is a 401 rather than a fake success.
        const user = await requireUser();
        return respond({
          authenticated: true,
          configured: true,
          user: { userId: user.userId, ...(user.email ? { email: user.email } : {}) },
        });
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const headers = new Headers({ "x-request-id": requestId });
        for (const value of options.auth?.signOut() ?? []) headers.append("set-cookie", value);
        return Response.json({ authenticated: false }, { headers });
      }

      // --- protected resources -------------------------------------------
      if (url.pathname === "/api/repositories" && request.method === "GET") {
        const user = await requireUser();
        if (!options.resources) throw new NotFoundError();
        return respond({ items: await options.resources.listRepositories(user.userId) });
      }
      if (url.pathname === "/api/repositories" && request.method === "POST") {
        const user = await requireUser();
        if (!options.resources) throw new NotFoundError();
        return respond(
          await options.resources.createRepository(user.userId, await request.json()),
          201,
        );
      }
      const repositoryMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)$/);
      if (repositoryMatch && request.method === "GET") {
        const user = await requireUser();
        if (!options.resources) throw new NotFoundError();
        return respond(await options.resources.getRepository(user.userId, repositoryMatch[1]!));
      }
      const indexMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/index$/);
      if (indexMatch && request.method === "POST") {
        const user = await requireUser();
        if (!options.resources) throw new NotFoundError();
        return respond(await options.resources.startIndex(user.userId, indexMatch[1]!), 202);
      }
      const indexStatusMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/index-status$/);
      if (indexStatusMatch && request.method === "GET") {
        const user = await requireUser();
        if (!options.resources) throw new NotFoundError();
        return respond(await options.resources.getIndexStatus(user.userId, indexStatusMatch[1]!));
      }
      const issuesMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/issues$/);
      if (issuesMatch && request.method === "GET") {
        const user = await requireUser();
        if (!options.resources) throw new NotFoundError();
        return respond({ items: await options.resources.listIssues(user.userId, issuesMatch[1]!) });
      }
      const issueMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/issues\/(\d+)$/);
      if (issueMatch && request.method === "GET") {
        const user = await requireUser();
        if (!options.resources) throw new NotFoundError();
        return respond(
          await options.resources.getIssue(user.userId, issueMatch[1]!, Number(issueMatch[2])),
        );
      }
      if (url.pathname === "/api/investigations" && request.method === "POST") {
        const user = await requireUser();
        const input = createInvestigationRequestSchema.parse(await request.json());
        // The repository must belong to the caller before work is queued.
        if (options.resources)
          await options.resources.getRepository(user.userId, input.repositoryId);
        const investigation = await service.create(user.userId, input);
        const response = createInvestigationResponseSchema.parse({
          investigationId: investigation.investigationId,
          status: investigation.status,
        });
        logger.info("investigation_queued", {
          requestId,
          userId: user.userId,
          investigationId: investigation.investigationId,
        });
        return respond(response, 202);
      }
      const statusMatch = url.pathname.match(/^\/api\/investigations\/([^/]+)\/status$/);
      if (statusMatch && request.method === "GET") {
        const user = await requireUser();
        const investigation = await service.get(user.userId, statusMatch[1]!);
        return respond(
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
        );
      }
      const match = url.pathname.match(/^\/api\/investigations\/([^/]+)$/);
      if (match && request.method === "GET") {
        const user = await requireUser();
        return respond(investigationSchema.parse(await service.get(user.userId, match[1]!)));
      }
      const evidenceMatch = url.pathname.match(/^\/api\/investigations\/([^/]+)\/evidence$/);
      if (evidenceMatch && request.method === "GET") {
        const user = await requireUser();
        if (!options.resources) throw new NotFoundError();
        return respond({
          items: await options.resources.listEvidence(user.userId, evidenceMatch[1]!),
        });
      }
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
