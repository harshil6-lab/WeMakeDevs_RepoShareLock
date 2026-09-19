import { createHash } from "node:crypto";
import type { ArtifactRepository } from "../storage/s3-repository";
import type { RepositoryChunkRecord, RepositoryStore } from "../storage/types";
import { s3Keys } from "../storage/keys";

const languageByExtension: Record<string, string> = {
  c: "C",
  cpp: "C++",
  go: "Go",
  java: "Java",
  js: "JavaScript",
  jsx: "JavaScript",
  json: "JSON",
  md: "Markdown",
  py: "Python",
  rs: "Rust",
  ts: "TypeScript",
  tsx: "TypeScript",
  yml: "YAML",
  yaml: "YAML",
};
const ignoredPathParts = new Set([".git", "node_modules", "dist", "build", "coverage"]);
const embeddingDimensions = 64;
const tokenPattern = /[a-zA-Z0-9_$-]+/g;

export type RetrievalConfig = {
  chunkSize?: number;
  overlap?: number;
  topK?: number;
  similarityThreshold?: number;
};

export type SourceChunk = {
  repositoryId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  commitSha: string;
  chunkId: string;
  language: string;
  content: string;
};

export type RetrievalResult = SourceChunk & {
  semanticScore: number;
  keywordScore: number;
  score: number;
};

type StoredChunk = RepositoryChunkRecord & {
  embedding: number[];
  filePath: string;
  commitSha: string;
};

const configWithDefaults = (config: RetrievalConfig = {}) => {
  const chunkSize = Math.max(1, Math.floor(config.chunkSize ?? 80));
  const overlap = Math.max(0, Math.floor(config.overlap ?? 10));
  if (overlap >= chunkSize) throw new Error("overlap must be smaller than chunkSize");
  return {
    chunkSize,
    overlap,
    topK: Math.max(1, Math.floor(config.topK ?? 8)),
    similarityThreshold: Math.min(1, Math.max(0, config.similarityThreshold ?? 0.15)),
  };
};

export function detectLanguage(filePath: string): string | undefined {
  const extension = filePath.split(".").at(-1)?.toLowerCase();
  return extension ? languageByExtension[extension] : undefined;
}

export function isIndexableSourceFile(filePath: string): boolean {
  return (
    Boolean(detectLanguage(filePath)) &&
    !filePath.split("/").some((part) => ignoredPathParts.has(part))
  );
}

export function chunkSourceFile(
  input: Omit<SourceChunk, "chunkId" | "startLine" | "endLine" | "language"> & {
    language?: string;
  },
  config: RetrievalConfig = {},
): SourceChunk[] {
  const resolved = configWithDefaults(config);
  const language = input.language ?? detectLanguage(input.filePath);
  if (!language) return [];
  const lines = input.content.split(/\r?\n/);
  const chunks: SourceChunk[] = [];
  const step = resolved.chunkSize - resolved.overlap;
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + resolved.chunkSize);
    const content = lines.slice(start, end).join("\n");
    const chunkId = createHash("sha256")
      .update(
        `${input.repositoryId}:${input.filePath}:${input.commitSha}:${start + 1}:${end}:${content}`,
      )
      .digest("hex")
      .slice(0, 24);
    chunks.push({
      ...input,
      chunkId,
      language,
      startLine: start + 1,
      endLine: end,
      content,
    });
    if (end === lines.length) break;
  }
  return chunks;
}

export function generateEmbedding(text: string): number[] {
  const vector = new Array<number>(embeddingDimensions).fill(0);
  for (const token of tokenize(text)) {
    const hash = createHash("sha256").update(token).digest();
    const index = hash[0]! % embeddingDimensions;
    vector[index] = (vector[index] ?? 0) + (hash[1]! % 2 === 0 ? 1 : -1);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(tokenPattern) ?? []).filter((token) => token.length > 1);
}

const proseExtensions = new Set(["md"]);

/** Down-weights descriptive prose so implementation files rank first. */
export function primarySourceWeight(filePath: string): number {
  const extension = filePath.split(".").at(-1)?.toLowerCase() ?? "";
  return proseExtensions.has(extension) ? 0.75 : 1;
}

function cosineSimilarity(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function keywordSimilarity(query: string, content: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;
  const contentTokens = new Set(tokenize(content));
  let matches = 0;
  for (const token of queryTokens) if (contentTokens.has(token)) matches += 1;
  return matches / queryTokens.size;
}

export async function indexSourceFile(
  storage: Pick<RepositoryStore, "chunks">,
  artifacts: Pick<ArtifactRepository, "putChunk">,
  input: Omit<SourceChunk, "chunkId" | "startLine" | "endLine" | "language"> & {
    language?: string;
  },
  now = new Date().toISOString(),
  config: RetrievalConfig = {},
): Promise<SourceChunk[]> {
  const chunks = chunkSourceFile(input, config);
  for (const chunk of chunks) {
    const objectKey = await artifacts.putChunk(
      chunk.repositoryId,
      chunk.chunkId,
      new TextEncoder().encode(JSON.stringify(chunk)),
    );
    const record: StoredChunk = {
      repositoryId: chunk.repositoryId,
      chunkId: chunk.chunkId,
      filePath: chunk.filePath,
      commitSha: chunk.commitSha,
      objectKey,
      contentHash: createHash("sha256").update(chunk.content).digest("hex"),
      language: chunk.language,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      embedding: generateEmbedding(chunk.content),
      createdAt: now,
      updatedAt: now,
    };
    await storage.chunks.put(record);
  }
  return chunks;
}

export async function retrieve(
  repositoryId: string,
  query: string,
  storage: Pick<RepositoryStore, "chunks">,
  artifacts: Pick<ArtifactRepository, "get">,
  config: RetrievalConfig = {},
): Promise<RetrievalResult[]> {
  const resolved = configWithDefaults(config);
  if (!query.trim()) return [];
  const queryEmbedding = generateEmbedding(query);
  const candidates: RetrievalResult[] = [];
  let nextToken: string | undefined;
  do {
    const page = await storage.chunks.listForRepository(repositoryId, nextToken, 100);
    for (const record of page.items as StoredChunk[]) {
      if (
        record.repositoryId !== repositoryId ||
        !record.embedding ||
        !record.filePath ||
        !record.commitSha
      )
        continue;
      const chunk = JSON.parse(
        new TextDecoder().decode(await artifacts.get(record.objectKey)),
      ) as SourceChunk;
      if (chunk.repositoryId !== repositoryId) continue;
      const semanticScore = cosineSimilarity(queryEmbedding, record.embedding);
      const keywordScore = keywordSimilarity(query, chunk.content);
      // Implementation files are primary evidence for a code investigation;
      // prose that merely repeats the symptom wording is supporting evidence.
      // The hybrid score alone lets a README or runbook outrank the code that
      // actually causes the defect, so prose is deterministically down-weighted.
      const score =
        (semanticScore * 0.7 + keywordScore * 0.3) * primarySourceWeight(chunk.filePath);
      if (score >= resolved.similarityThreshold)
        candidates.push({ ...chunk, semanticScore, keywordScore, score });
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return candidates
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.keywordScore - left.keywordScore ||
        left.chunkId.localeCompare(right.chunkId),
    )
    .slice(0, resolved.topK);
}
