import { describe, expect, it } from "vitest";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  createBedrockModel,
  loadBedrockConfig,
  maxBedrockRequestTokens,
} from "../src/investigation/bedrock";

describe("bedrock model adapter", () => {
  it("invokes Converse for the configured model and returns its text", async () => {
    const sent: unknown[] = [];
    const client = {
      send: async (command: unknown) => {
        sent.push(command);
        return { output: { message: { content: [{ text: '{"claims":[]}' }] } } };
      },
    };
    const model = createBedrockModel({ modelId: "test.model-v1", client: client as never });
    const text = await model.converse("SYSTEM", "USER", 512);
    expect(text).toBe('{"claims":[]}');
    expect(sent).toHaveLength(1);
    const command = sent[0];
    expect(command).toBeInstanceOf(ConverseCommand);
    expect((command as ConverseCommand).input).toMatchObject({
      modelId: "test.model-v1",
      system: [{ text: "SYSTEM" }],
      messages: [{ role: "user", content: [{ text: "USER" }] }],
      inferenceConfig: { maxTokens: 512 },
    });
  });

  it("returns every text content block, not just the first", async () => {
    // Converse returns an ordered ContentBlock[]. SYNTHESIZE may put reasoning
    // JSON in the first text block and the claims envelope in a later one;
    // returning only the first block dropped the envelope and produced
    // "claims: Required (undefined)".
    const client = {
      send: async () => ({
        output: {
          message: {
            content: [
              { text: '{"analysis":"the handler awaits the provider"}' },
              { text: '{"claims":[{"text":"t","evidenceIds":["file:a:1-2"]}]}' },
            ],
          },
        },
      }),
    };
    const model = createBedrockModel({ modelId: "test.model-v1", client: client as never });
    const text = await model.converse("SYSTEM", "USER", 512);
    expect(text).toBe(
      '{"analysis":"the handler awaits the provider"}\n' +
        '{"claims":[{"text":"t","evidenceIds":["file:a:1-2"]}]}',
    );
  });
  it("forwards every block of a two-block Converse response to the JSON parser", async () => {
    // Exact production SYNTHESIZE shape: a reasoning object in the first text
    // block and the claims envelope in the second. parseModelJson is schema
    // driven and iterates the candidates of whatever string it is handed, so
    // the adapter must hand it BOTH blocks; returning only the first is what
    // produced "claims: Required (undefined)" in production.
    const reasoning = '{"analysis":"reasoning"}';
    const envelope = '{"claims":[{"text":"test","evidenceIds":["file:test"]}]}';
    const client = {
      send: async () => ({
        output: { message: { content: [{ text: reasoning }, { text: envelope }] } },
      }),
    };
    const model = createBedrockModel({ modelId: "test.model-v1", client: client as never });
    const text = await model.converse("SYSTEM", "USER", 512);
    expect(text.split("\n")).toEqual([reasoning, envelope]);
    expect(text).toContain('"claims"');
  });

  it("fails instead of returning empty text", async () => {
    const model = createBedrockModel({
      modelId: "test.model-v1",
      client: { send: async () => ({ output: {} }) } as never,
    });
    await expect(model.converse("s", "u", 256)).rejects.toThrow("Bedrock returned no text content");
  });
});
describe("bedrock runtime configuration", () => {
  it("defaults the region to ap-south-1 and the token budget to 1200", () => {
    const config = loadBedrockConfig({ REPOSHERLOCK_BEDROCK_MODEL_ID: "test.model-v1" });
    expect(config).toEqual({
      modelId: "test.model-v1",
      region: "ap-south-1",
      maxTokens: 1200,
    });
    expect(maxBedrockRequestTokens).toBe(1200);
  });

  it("accepts a configured model id and region without a hardcoded model", () => {
    const config = loadBedrockConfig({
      REPOSHERLOCK_BEDROCK_MODEL_ID: "some.other-model-v2",
      AWS_REGION: "eu-west-1",
    });
    expect(config.modelId).toBe("some.other-model-v2");
    expect(config.region).toBe("eu-west-1");
  });

  it("requires the model id rather than defaulting it", () => {
    expect(() => loadBedrockConfig({ AWS_REGION: "ap-south-1" })).toThrow(
      "REPOSHERLOCK_BEDROCK_MODEL_ID is required",
    );
  });

  it("clamps a larger token budget to 1200 and preserves a smaller one", () => {
    expect(
      loadBedrockConfig({
        REPOSHERLOCK_BEDROCK_MODEL_ID: "test.model-v1",
        REPOSHERLOCK_BEDROCK_MAX_TOKENS: "9999",
      }).maxTokens,
    ).toBe(1200);
    expect(
      loadBedrockConfig({
        REPOSHERLOCK_BEDROCK_MODEL_ID: "test.model-v1",
        REPOSHERLOCK_BEDROCK_MAX_TOKENS: "512",
      }).maxTokens,
    ).toBe(512);
  });

  it("raises a below-minimum token budget and ignores a non-numeric one", () => {
    expect(
      loadBedrockConfig({
        REPOSHERLOCK_BEDROCK_MODEL_ID: "test.model-v1",
        REPOSHERLOCK_BEDROCK_MAX_TOKENS: "10",
      }).maxTokens,
    ).toBe(256);
    expect(
      loadBedrockConfig({
        REPOSHERLOCK_BEDROCK_MODEL_ID: "test.model-v1",
        REPOSHERLOCK_BEDROCK_MAX_TOKENS: "not-a-number",
      }).maxTokens,
    ).toBe(1200);
  });
});
