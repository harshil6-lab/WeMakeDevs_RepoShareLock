import { describe, expect, it } from "vitest";
import {
  chunkSourceFile,
  detectLanguage,
  generateEmbedding,
  indexSourceFile,
  isIndexableSourceFile,
  primarySourceWeight,
  retrieve,
} from "../src/retrieval";
import type { RepositoryChunkRecord } from "../src/storage/types";

function dependencies(records: RepositoryChunkRecord[]) {
  const bodies = new Map<string, Uint8Array>();
  return {
    storage: {
      chunks: {
        put: async (record: RepositoryChunkRecord) => records.push(record),
        listForRepository: async (repositoryId: string) => ({
          items: records.filter((record) => record.repositoryId === repositoryId),
        }),
      },
    },
    artifacts: {
      putChunk: async (_repositoryId: string, chunkId: string, body: Uint8Array) => {
        bodies.set(chunkId, body);
        return `chunks/${chunkId}`;
      },
      get: async (key: string) => bodies.get(key.replace("chunks/", "")) ?? new Uint8Array(),
    },
  };
}

describe("repository retrieval", () => {
  it("filters files, detects languages, and preserves chunk provenance", async () => {
    expect(isIndexableSourceFile("src/app.ts")).toBe(true);
    expect(isIndexableSourceFile("node_modules/app.ts")).toBe(false);
    expect(detectLanguage("src/app.tsx")).toBe("TypeScript");
    const chunks = chunkSourceFile(
      {
        repositoryId: "repo-a",
        filePath: "src/app.ts",
        commitSha: "sha-a",
        content: "one\ntwo\nthree",
      },
      { chunkSize: 2, overlap: 1 },
    );
    expect(chunks.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(chunks[0]).toMatchObject({
      repositoryId: "repo-a",
      filePath: "src/app.ts",
      commitSha: "sha-a",
      language: "TypeScript",
    });
    const records: RepositoryChunkRecord[] = [];
    const deps = dependencies(records);
    await indexSourceFile(deps.storage, deps.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/app.ts",
      commitSha: "sha-a",
      content: "payment timeout handler",
    });
    expect(records[0]).toMatchObject({
      filePath: "src/app.ts",
      commitSha: "sha-a",
      startLine: 1,
      endLine: 1,
      language: "TypeScript",
    });
    expect(records[0]?.embedding).toHaveLength(64);
  });

  it("ranks hybrid matches and never crosses repository boundaries", async () => {
    const records: RepositoryChunkRecord[] = [];
    const deps = dependencies(records);
    await indexSourceFile(deps.storage, deps.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      commitSha: "a",
      content: "payment timeout handler",
    });
    await indexSourceFile(deps.storage, deps.artifacts, {
      repositoryId: "repo-b",
      filePath: "src/payment.ts",
      commitSha: "b",
      content: "payment timeout handler",
    });
    const results = await retrieve("repo-a", "payment timeout", deps.storage, deps.artifacts);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      repositoryId: "repo-a",
      filePath: "src/payment.ts",
      startLine: 1,
      endLine: 1,
    });
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("ranks implementation files above prose for a code investigation query", async () => {
    const records: RepositoryChunkRecord[] = [];
    const deps = dependencies(records);
    // Identical content isolates the ranking policy: only the source kind differs.
    const content = "payment webhook timeout provider acknowledge before returning";
    await indexSourceFile(deps.storage, deps.artifacts, {
      repositoryId: "repo-a",
      filePath: "docs/runbooks/payments-webhooks.md",
      commitSha: "a",
      content,
    });
    await indexSourceFile(deps.storage, deps.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/webhooks/payment.ts",
      commitSha: "a",
      content,
    });
    const results = await retrieve(
      "repo-a",
      "payment webhook timeout",
      deps.storage,
      deps.artifacts,
    );
    expect(primarySourceWeight("docs/runbooks/payments-webhooks.md")).toBeLessThan(
      primarySourceWeight("src/webhooks/payment.ts"),
    );
    expect(results[0]?.filePath).toBe("src/webhooks/payment.ts");
  });

  it("returns empty results for blank or below-threshold queries", async () => {
    const records: RepositoryChunkRecord[] = [];
    const deps = dependencies(records);
    await indexSourceFile(deps.storage, deps.artifacts, {
      repositoryId: "repo-a",
      filePath: "src/app.ts",
      commitSha: "a",
      content: "unrelated content",
    });
    expect(await retrieve("repo-a", "   ", deps.storage, deps.artifacts)).toEqual([]);
    expect(
      await retrieve("repo-a", "payment", deps.storage, deps.artifacts, { similarityThreshold: 1 }),
    ).toEqual([]);
  });
});

describe("embedding pipeline", () => {
  it("produces deterministic, unit-normalized vectors", () => {
    const first = generateEmbedding("payment webhook timeout provider");
    const second = generateEmbedding("payment webhook timeout provider");
    expect(first).toEqual(second);
    expect(first).toHaveLength(64);
    const magnitude = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 6);
    expect(generateEmbedding("unrelated session refresh token")).not.toEqual(first);
  });

  it("returns a zero vector when there are no indexable tokens", () => {
    expect(generateEmbedding("   !!  ").every((value) => value === 0)).toBe(true);
  });

  it("rejects an overlap that is not smaller than the chunk size", () => {
    expect(() =>
      chunkSourceFile(
        { repositoryId: "repo-a", filePath: "src/app.ts", commitSha: "sha-a", content: "x" },
        { chunkSize: 2, overlap: 2 },
      ),
    ).toThrow(/overlap/);
  });
});
