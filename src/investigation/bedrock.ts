import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";

export type BedrockModel = {
  converse: (systemPrompt: string, userPrompt: string, maxTokens: number) => Promise<string>;
};

export type BedrockModelOptions = {
  modelId: string;
  region?: string;
  /** When set, the client assumes this role instead of using the default chain. */
  roleArn?: string;
  client?: Pick<BedrockRuntimeClient, "send">;
};

/** Session name used for the cross-account Bedrock role assumption. */
const bedrockRoleSessionName = "reposherlock-bedrock";

/**
 * Builds the Bedrock Runtime client. With no role ARN it keeps the default AWS
 * credential chain; with a role ARN it assumes that role (in the Bedrock
 * account) and uses the assumed credentials for the runtime call.
 */
function createBedrockClient(options: BedrockModelOptions): BedrockRuntimeClient {
  const clientConfig = options.region === undefined ? {} : { region: options.region };
  if (!options.roleArn) return new BedrockRuntimeClient(clientConfig);
  return new BedrockRuntimeClient({
    ...clientConfig,
    credentials: fromTemporaryCredentials({
      params: { RoleArn: options.roleArn, RoleSessionName: bedrockRoleSessionName },
      clientConfig,
    }),
  });
}

export function createBedrockModel(options: BedrockModelOptions): BedrockModel {
  const client = options.client ?? createBedrockClient(options);
  return {
    converse: async (systemPrompt, userPrompt, maxTokens) => {
      const response = await client.send(
        new ConverseCommand({
          modelId: options.modelId,
          system: [{ text: systemPrompt }],
          messages: [{ role: "user", content: [{ text: userPrompt }] }],
          inferenceConfig: { maxTokens },
        }),
      );
      // Converse returns the answer as an ordered list of content blocks, and a
      // model may split it across several text blocks (for example a reasoning
      // block followed by the JSON answer). Returning only the first text block
      // dropped the SYNTHESIZE claims envelope, which surfaced as
      // "claims: Required (undefined)". Keep every text block, in order.
      const text = (response.output?.message?.content ?? [])
        .map((item) => item.text)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("\n");
      if (!text) throw new Error("Bedrock returned no text content");
      return text;
    },
  };
}

/** Per-request Bedrock output budget. Callers may lower it but never exceed it. */
export const maxBedrockRequestTokens = 1200;
const minBedrockRequestTokens = 256;

/** Clamps the configured token budget, ignoring non-numeric configuration. */
function resolveMaxRequestTokens(value: string | undefined): number {
  const parsed = Number(value ?? maxBedrockRequestTokens);
  if (!Number.isFinite(parsed)) return maxBedrockRequestTokens;
  return Math.min(Math.max(Math.floor(parsed), minBedrockRequestTokens), maxBedrockRequestTokens);
}

export type BedrockConfig = {
  modelId: string;
  region: string;
  maxTokens: number;
  /** Optional cross-account role assumed for Bedrock invocation. */
  roleArn?: string;
};

export function loadBedrockConfig(env: Record<string, string | undefined> = {}): BedrockConfig {
  const modelId = env["REPOSHERLOCK_BEDROCK_MODEL_ID"];
  if (!modelId) throw new Error("REPOSHERLOCK_BEDROCK_MODEL_ID is required");
  const config: BedrockConfig = {
    modelId,
    region: env["AWS_REGION"] ?? "ap-south-1",
    maxTokens: resolveMaxRequestTokens(env["REPOSHERLOCK_BEDROCK_MAX_TOKENS"]),
  };
  const roleArn = env["REPOSHERLOCK_BEDROCK_ROLE_ARN"];
  if (roleArn) config.roleArn = roleArn;
  return config;
}
