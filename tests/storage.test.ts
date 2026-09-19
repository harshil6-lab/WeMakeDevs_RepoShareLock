import { describe, expect, it } from "vitest";
import { createDynamoRepository } from "../src/storage/dynamo-repository";
import { tableKeys, s3Keys } from "../src/storage/keys";
import { createS3ArtifactRepository } from "../src/storage/s3-repository";

type Command = { input: Record<string, unknown> };
function fakeClient(responses: Record<string, unknown> = {}) {
  const calls: Command[] = [];
  return {
    calls,
    client: {
      send: async (command: Command) => {
        calls.push(command);
        return responses[command.constructor.name] ?? {};
      },
    },
  };
}

describe("storage keys", () => {
  it("builds stable entity and relationship keys", () => {
    expect(tableKeys.user("u1")).toEqual({ PK: "USER#u1", SK: "PROFILE" });
    expect(tableKeys.evidence("inv1", "ev1")).toEqual({
      PK: "INVESTIGATION#inv1",
      SK: "EVIDENCE#ev1",
    });
    expect(tableKeys.issue("repo1", 42)).toEqual({ PK: "REPOSITORY#repo1", SK: "ISSUE#42" });
  });

  it("builds repository snapshot and raw artifact keys", () => {
    expect(s3Keys.snapshot("repo1", "v1")).toBe("repositories/repo1/snapshots/v1/snapshot.tar.gz");
    expect(s3Keys.rawArtifact("repo1", "/src/index.ts")).toBe(
      "repositories/repo1/raw/src/index.ts",
    );
  });
});

describe("DynamoDB repository", () => {
  it("supports create/get/update operations", async () => {
    const { client, calls } = fakeClient({
      GetCommand: { Item: { userId: "u1", status: "active" } },
    });
    const store = createDynamoRepository({ tableName: "table", client });
    await store.users.create({
      userId: "u1",
      status: "active",
      createdAt: "now",
      updatedAt: "now",
    });
    expect(await store.users.get("u1")).toEqual({ userId: "u1", status: "active" });
    await store.repositories.updateIndexingStatus("repo1", "completed", "later");
    expect(calls.map((call) => call.constructor.name)).toEqual([
      "PutCommand",
      "GetCommand",
      "UpdateCommand",
    ]);
  });

  it("retrieves investigation evidence with pagination", async () => {
    const { client } = fakeClient({
      QueryCommand: { Items: [{ evidenceId: "ev1" }], LastEvaluatedKey: { PK: "x", SK: "y" } },
    });
    const page = await createDynamoRepository({
      tableName: "table",
      client,
    }).evidence.listForInvestigation("inv1", undefined, 10);
    expect(page.items).toEqual([{ evidenceId: "ev1" }]);
    expect(page.nextToken).toBeDefined();
  });

  it("retrieves repository indexing status through the repository boundary", async () => {
    const { client } = fakeClient({
      GetCommand: { Item: { repositoryId: "repo1", indexingStatus: "running" } },
    });
    const repository = await createDynamoRepository({
      tableName: "table",
      client,
    }).repositories.get("repo1");
    expect(repository?.indexingStatus).toBe("running");
  });
});

describe("S3 artifact repository", () => {
  it("writes and reads through the artifact interface", async () => {
    const { client, calls } = fakeClient({ GetObjectCommand: { Body: new Uint8Array([1, 2]) } });
    const artifacts = createS3ArtifactRepository({ bucketName: "bucket", client });
    expect(await artifacts.putSnapshot("repo1", "v1", new Uint8Array([3]))).toBe(
      "repositories/repo1/snapshots/v1/snapshot.tar.gz",
    );
    expect(await artifacts.get("repositories/repo1/raw/a.ts")).toEqual(new Uint8Array([1, 2]));
    expect(calls.map((call) => call.constructor.name)).toEqual([
      "PutObjectCommand",
      "GetObjectCommand",
    ]);
  });
});
