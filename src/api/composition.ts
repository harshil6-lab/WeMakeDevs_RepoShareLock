import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { createBedrockModel, loadBedrockConfig } from "../investigation/bedrock";
import { ingestRepository } from "../github/ingestion";
import { createGitHubClient } from "../github/client";
import type { GitHubClient } from "../github/types";
import { createDynamoRepository } from "../storage/dynamo-repository";
import { createS3ArtifactRepository, type ArtifactRepository } from "../storage/s3-repository";
import type { RepositoryStore } from "../storage/types";
import type { BedrockModel } from "../investigation/bedrock";
import { loadConfig } from "./config";
import { createLogger, type StructuredLogger } from "./logger";
import { createRepositoryResourceService } from "./resources";
import { createApiRouter } from "./router";
import {
  createInvestigationWorker,
  type InvestigationWorker,
  type InvestigationWorkerEvent,
} from "./worker";

export type ApiRequestHandler = (request: Request) => Promise<Response | undefined>;

export type CompositionEnv = Record<string, string | undefined>;

export type CompositionOverrides = {
  storage?: RepositoryStore;
  artifacts?: ArtifactRepository;
  github?: GitHubClient;
  model?: BedrockModel;
  logger?: StructuredLogger;
  userId?: string;
  /** Injected for tests; the runtime creates its own Lambda client by default. */
  lambdaClient?: Pick<LambdaClient, "send">;
};

/** Work that the deployed Lambda runs outside the request/response cycle. */
export type AsyncWorkEvent =
  | { kind: "investigation"; investigationId: string }
  | { kind: "index"; repositoryId: string; userId: string };

export type AsyncDispatcher = (event: AsyncWorkEvent) => Promise<void>;

/** Marker that distinguishes an asynchronous self-invocation from an HTTP event. */
export const asyncEventMarker = "reposherlock.async";

/**
 * Dispatches work to the deployed Lambda with `InvocationType: Event`, so the
 * HTTP handler can return immediately and Lambda cannot freeze the work before
 * it runs. A client may be injected for tests.
 */
export function createLambdaDispatcher(
  functionName: string,
  client?: Pick<LambdaClient, "send">,
): AsyncDispatcher {
  const lambda = client ?? new LambdaClient({});
  return async (event) => {
    await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(JSON.stringify({ marker: asyncEventMarker, ...event })),
      }),
    );
  };
}

export type CompositionRuntime = {
  storage: RepositoryStore;
  artifacts: ArtifactRepository;
  github: GitHubClient;
  model: BedrockModel;
  logger: StructuredLogger;
  userId: string;
  worker: InvestigationWorker;
  /** Runs ingestion in-process; used by the async Lambda path and local runs. */
  runIndex: (event: { repositoryId: string; userId: string }) => Promise<void>;
  /** Requests indexing, asynchronously when a Lambda dispatch target is configured. */
  startIndex: (repositoryId: string) => Promise<void>;
};

/**
 * Builds the approved components (storage, artifacts, GitHub, retrieval, worker,
 * Bedrock, resource adapter). This is a wiring function, not new architecture:
 * the HTTP router and the asynchronous Lambda entry share the same components.
 * Returns `undefined` when required configuration is absent.
 */
export function createCompositionRuntime(
  env: CompositionEnv = {},
  overrides: CompositionOverrides = {},
): CompositionRuntime | undefined {
  const logger = overrides.logger ?? createLogger(loadConfig(env));
  const userId = overrides.userId ?? env["REPOSHERLOCK_USER_ID"] ?? "local-user";

  const tableName = env["REPOSHERLOCK_TABLE_NAME"];
  const bucketName = env["REPOSHERLOCK_BUCKET_NAME"];
  const bedrockModelId = env["REPOSHERLOCK_BEDROCK_MODEL_ID"];
  const githubToken = env["REPOSHERLOCK_GITHUB_TOKEN"];

  const storage =
    overrides.storage ?? (tableName ? createDynamoRepository({ tableName }) : undefined);
  const artifacts =
    overrides.artifacts ?? (bucketName ? createS3ArtifactRepository({ bucketName }) : undefined);
  const github =
    overrides.github ??
    (githubToken
      ? createGitHubClient({ tokenProvider: async () => githubToken, logger })
      : undefined);
  const model =
    overrides.model ?? (bedrockModelId ? createBedrockModel(loadBedrockConfig(env)) : undefined);

  if (!storage || !artifacts || !github || !model) {
    logger.warn("api_not_configured", {
      hasStorage: Boolean(storage),
      hasArtifacts: Boolean(artifacts),
      hasGithub: Boolean(github),
      hasModel: Boolean(model),
    });
    return undefined;
  }

  // Lambda sets AWS_LAMBDA_FUNCTION_NAME automatically; the explicit override is
  // used for local testing and for aliases/versions.
  const asyncFunctionName =
    env["REPOSHERLOCK_ASYNC_FUNCTION_NAME"] ?? env["AWS_LAMBDA_FUNCTION_NAME"];
  const dispatch = asyncFunctionName
    ? createLambdaDispatcher(asyncFunctionName, overrides.lambdaClient)
    : undefined;

  const runIndex = async (event: { repositoryId: string; userId: string }) => {
    const repository = await storage.repositories.get(event.repositoryId);
    if (!repository) return;
    try {
      await ingestRepository(
        github,
        storage,
        artifacts,
        {
          userId: event.userId,
          owner: repository.owner,
          name: repository.name,
          repositoryId: event.repositoryId,
        },
        { logger },
      );
    } catch (error) {
      // A failed index must be visible to the polling client instead of
      // leaving the repository stuck in `running` forever.
      await storage.repositories.updateIndexingStatus(
        event.repositoryId,
        "failed",
        new Date().toISOString(),
      );
      logger.error("repository_indexing_failed", {
        repositoryId: event.repositoryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const worker = createInvestigationWorker({
    storage,
    artifacts,
    github,
    model,
    logger,
    ...(dispatch
      ? {
          invokeAsync: (event: InvestigationWorkerEvent) =>
            dispatch({ kind: "investigation", investigationId: event.investigationId }),
        }
      : {}),
  });

  const startIndex = async (repositoryId: string) => {
    try {
      if (dispatch) await dispatch({ kind: "index", repositoryId, userId });
      else await runIndex({ repositoryId, userId });
    } catch (error) {
      logger.error("repository_index_start_failed", {
        repositoryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    storage,
    artifacts,
    github,
    model,
    logger,
    userId,
    worker,
    runIndex,
    startIndex,
  };
}

/**
 * Application composition root for the HTTP router.
 *
 * It only *wires* the approved components into the existing fetch router. It
 * does not add a service, a queue, or a second persistence layer. Returns
 * `undefined` when required configuration is absent so callers can keep a safe
 * fallback.
 */
export function createConfiguredApiRouter(
  env: CompositionEnv = {},
  overrides: CompositionOverrides = {},
): ApiRequestHandler | undefined {
  const runtime = createCompositionRuntime(env, overrides);
  if (!runtime) return undefined;

  const resources = createRepositoryResourceService({
    storage: runtime.storage,
    userId: runtime.userId,
    github: runtime.github,
    startIndex: runtime.startIndex,
  });

  return createApiRouter({
    config: loadConfig(env),
    logger: runtime.logger,
    storage: runtime.storage,
    worker: runtime.worker,
    resources,
  });
}

/** Reads composition configuration from a platform env binding, if present. */
export function readCompositionEnv(binding: unknown): CompositionEnv {
  const env: CompositionEnv = {};
  if (binding && typeof binding === "object") {
    for (const [key, value] of Object.entries(binding as Record<string, unknown>))
      if (typeof value === "string") env[key] = value;
  }
  const processEnv = globalThis.process?.env;
  if (processEnv && typeof processEnv === "object") {
    for (const [key, value] of Object.entries(processEnv))
      if (typeof value === "string") env[key] = value;
  }
  return env;
}
