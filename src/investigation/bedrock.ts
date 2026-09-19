import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

export type BedrockModel = {
  converse: (systemPrompt: string, userPrompt: string, maxTokens: number) => Promise<string>;
};

export type BedrockModelOptions = {
  modelId: string;
  region?: string;
  client?: Pick<BedrockRuntimeClient, "send">;
};

export function createBedrockModel(options: BedrockModelOptions): BedrockModel {
  const client =
    options.client ??
    new BedrockRuntimeClient(options.region === undefined ? {} : { region: options.region });
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
      const text = response.output?.message?.content?.find((item) => item.text)?.text;
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

export function loadBedrockConfig(env: Record<string, string | undefined> = {}) {
  const modelId = env["REPOSHERLOCK_BEDROCK_MODEL_ID"];
  if (!modelId) throw new Error("REPOSHERLOCK_BEDROCK_MODEL_ID is required");
  return {
    modelId,
    region: env["AWS_REGION"] ?? "ap-south-1",
    maxTokens: resolveMaxRequestTokens(env["REPOSHERLOCK_BEDROCK_MAX_TOKENS"]),
  };
}
