import { beforeEach, describe, expect, it, vi } from "vitest";

const { constructorCalls, fromTemporaryCredentials } = vi.hoisted(() => ({
  constructorCalls: [] as unknown[],
  fromTemporaryCredentials: vi.fn((options: unknown) => ({
    kind: "assumed-credentials",
    options,
  })),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    constructor(config: unknown) {
      constructorCalls.push(config);
    }
    async send() {
      return { output: { message: { content: [{ text: "ok" }] } } };
    }
  },
  ConverseCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

vi.mock("@aws-sdk/credential-providers", () => ({ fromTemporaryCredentials }));

import { createBedrockModel, loadBedrockConfig } from "../src/investigation/bedrock";

const roleArn = "arn:aws:iam::343218215737:role/RepoSherlockBedrockRole";

describe("bedrock cross-account credentials", () => {
  beforeEach(() => {
    constructorCalls.length = 0;
    fromTemporaryCredentials.mockClear();
  });

  it("uses the default credential chain when no role ARN is configured", async () => {
    const model = createBedrockModel({ modelId: "test.model-v1", region: "ap-south-1" });
    await model.converse("s", "u", 512);
    expect(fromTemporaryCredentials).not.toHaveBeenCalled();
    expect(constructorCalls.at(-1)).toEqual({ region: "ap-south-1" });
    expect(constructorCalls.at(-1)).not.toHaveProperty("credentials");
  });

  it("assumes the configured role and hands the assumed credentials to the client", async () => {
    const model = createBedrockModel({ modelId: "test.model-v1", region: "ap-south-1", roleArn });
    await model.converse("s", "u", 512);
    expect(fromTemporaryCredentials).toHaveBeenCalledTimes(1);
    const call = fromTemporaryCredentials.mock.calls[0]![0] as {
      params: { RoleArn: string; RoleSessionName: string };
    };
    expect(call.params.RoleArn).toBe(roleArn);
    const config = constructorCalls.at(-1) as { credentials: unknown };
    expect(config.credentials).toEqual({ kind: "assumed-credentials", options: call });
  });

  it("carries an optional cross-account role ARN from the environment through configuration", () => {
    expect(
      loadBedrockConfig({ REPOSHERLOCK_BEDROCK_MODEL_ID: "test.model-v1" }),
    ).not.toHaveProperty("roleArn");
    const withRole = loadBedrockConfig({
      REPOSHERLOCK_BEDROCK_MODEL_ID: "test.model-v1",
      AWS_REGION: "ap-south-1",
      REPOSHERLOCK_BEDROCK_ROLE_ARN: roleArn,
    });
    expect(withRole.roleArn).toBe(roleArn);
    expect(withRole.modelId).toBe("test.model-v1");
    expect(withRole.region).toBe("ap-south-1");
  });
});
