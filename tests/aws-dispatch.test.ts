import { describe, expect, it } from "vitest";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  asyncEventMarker,
  createCompositionRuntime,
  createLambdaDispatcher,
} from "../src/api/composition";
import type { Investigation } from "../src/api/schemas";
import type { StructuredLogger } from "../src/api/logger";
import { goldenExpectations, goldenRepositoryFixture } from "./fixtures/golden-repository.fixture";
import { createGoldenGitHubClient } from "./golden/golden-github-client";
import { createRecordingBedrockModel } from "./golden/golden-model";
import {
  createInMemoryArtifactRepository,
  createInMemoryRepositoryStore,
} from "./golden/in-memory-store";

type SentCommand = { input: Record<string, unknown> };

function createFakeLambdaClient() {
  const sent: SentCommand[] = [];
  return {
    sent,
    client: {
      send: async (command: unknown) => {
        sent.push(command as SentCommand);
        return {};
      },
    },
  };
}

function decodePayload(command: SentCommand): unknown {
  const payload = command.input["Payload"] as Uint8Array;
  return JSON.parse(new TextDecoder().decode(payload));
}

const logger: StructuredLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Lambda async dispatch", () => {
  it("invokes with InvocationType Event and a marked payload", async () => {
    const fake = createFakeLambdaClient();
    const dispatch = createLambdaDispatcher("reposherlock-api", fake.client);
    await dispatch({ kind: "investigation", investigationId: "inv-1" });
    expect(fake.sent).toHaveLength(1);
    const command = fake.sent[0]!;
    expect(command).toBeInstanceOf(InvokeCommand);
    expect(command.input["FunctionName"]).toBe("reposherlock-api");
    expect(command.input["InvocationType"]).toBe("Event");
    expect(command.input["Payload"]).toBeInstanceOf(Uint8Array);
    expect(decodePayload(command)).toEqual({
      marker: asyncEventMarker,
      kind: "investigation",
      investigationId: "inv-1",
    });
  });

  it("dispatches investigations and indexing without running them in the request", async () => {
    const store = createInMemoryRepositoryStore();
    const artifacts = createInMemoryArtifactRepository();
    const fake = createFakeLambdaClient();
    await store.repositories.create({
      repositoryId: goldenExpectations.repositoryId,
      userId: "user-1",
      owner: goldenRepositoryFixture.owner,
      name: goldenRepositoryFixture.name,
      defaultBranch: goldenRepositoryFixture.defaultBranch,
      indexingStatus: "not_started",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const runtime = createCompositionRuntime(
      { AWS_LAMBDA_FUNCTION_NAME: "reposherlock-api" },
      {
        storage: store,
        artifacts,
        github: createGoldenGitHubClient(),
        model: createRecordingBedrockModel(),
        logger,
        userId: "user-1",
        lambdaClient: fake.client,
      },
    );
    expect(runtime).toBeDefined();

    const investigation: Investigation = {
      investigationId: "11111111-1111-4111-8111-111111111111",
      repositoryId: goldenExpectations.repositoryId,
      issueNumber: goldenExpectations.issueNumber,
      status: "queued",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    runtime!.worker.enqueue(investigation);
    await settle();
    expect(decodePayload(fake.sent[0]!)).toMatchObject({
      marker: asyncEventMarker,
      kind: "investigation",
      investigationId: investigation.investigationId,
    });

    await runtime!.startIndex("user-1", goldenExpectations.repositoryId);
    await settle();
    expect(decodePayload(fake.sent[1]!)).toMatchObject({
      marker: asyncEventMarker,
      kind: "index",
      repositoryId: goldenExpectations.repositoryId,
      userId: "user-1",
    });
    // Nothing ran in-process: indexing is still requested, not completed.
    const record = await store.repositories.get(goldenExpectations.repositoryId);
    expect(record?.indexingStatus).toBe("not_started");
    expect(store.filesStored).toHaveLength(0);
  });
});
