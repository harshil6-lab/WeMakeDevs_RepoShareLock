import { describe, expect, it } from "vitest";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { createBedrockModel } from "../src/investigation/bedrock";

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

  it("fails instead of returning empty text", async () => {
    const model = createBedrockModel({
      modelId: "test.model-v1",
      client: { send: async () => ({ output: {} }) } as never,
    });
    await expect(model.converse("s", "u", 256)).rejects.toThrow("Bedrock returned no text content");
  });
});
