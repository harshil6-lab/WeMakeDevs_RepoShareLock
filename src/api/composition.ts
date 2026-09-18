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
import { createInvestigationWorker } from "./worker";

export type ApiRequestHandler = (request: Request) => Promise<Response | undefined>;

export type CompositionEnv = Record<string, string | undefined>;

export type CompositionOverrides = {
  storage?: RepositoryStore;
  artifacts?: ArtifactRepository;
  github?: GitHubClient;
  model?: BedrockModel;
  logger?: StructuredLogger;
  userId?: string;
};

/**
 * Application composition root.
 *
 * It only *wires* the approved components (storage, GitHub, retrieval, worker,
 * agent, Bedrock, resource adapter) into the existing fetch router. It does not
 * add a service, a queue, or a second persistence layer. Returns `undefined`
 * when required configuration is absent so callers can keep a safe fallback.
 */
export function createConfiguredApiRouter(
  env: CompositionEnv = {},
  overrides: CompositionOverrides = {},
): ApiRequestHandler | undefined {
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

  const worker = createInvestigationWorker({ storage, artifacts, github, model, logger });

  const resources = createRepositoryResourceService({
    storage,
    userId,
    github,
    startIndex: async (repositoryId) => {
      const repository = await storage.repositories.get(repositoryId);
      if (!repository) return;
      try {
        await ingestRepository(
          github,
          storage,
          artifacts,
          { userId, owner: repository.owner, name: repository.name, repositoryId },
          { logger },
        );
      } catch (error) {
        // A failed index must be visible to the polling client instead of
        // leaving the repository stuck in `running` forever.
        await storage.repositories.updateIndexingStatus(
          repositoryId,
          "failed",
          new Date().toISOString(),
        );
        logger.error("repository_indexing_failed", {
          repositoryId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  return createApiRouter({
    config: loadConfig(env),
    logger,
    storage,
    worker,
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
