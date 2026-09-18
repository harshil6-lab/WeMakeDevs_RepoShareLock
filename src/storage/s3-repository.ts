import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { StorageError } from "./errors";
import { s3Keys } from "./keys";

type S3ClientPort = Pick<S3Client, "send">;

export type ArtifactRepository = {
  putSnapshot: (repositoryId: string, snapshotVersion: string, body: Uint8Array) => Promise<string>;
  putRawArtifact: (repositoryId: string, artifactPath: string, body: Uint8Array) => Promise<string>;
  putChunk: (repositoryId: string, chunkId: string, body: Uint8Array) => Promise<string>;
  get: (objectKey: string) => Promise<Uint8Array>;
};

export type S3RepositoryOptions = { bucketName: string; client?: S3ClientPort };

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (
    body &&
    typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray ===
      "function"
  ) {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  throw new StorageError("STORAGE_READ_FAILED", "S3 object body could not be read");
}

export function createS3ArtifactRepository(options: S3RepositoryOptions): ArtifactRepository {
  const client = options.client ?? new S3Client({});
  const put = async (objectKey: string, body: Uint8Array) => {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucketName,
          Key: objectKey,
          Body: body,
          ServerSideEncryption: "AES256",
        }),
      );
      return objectKey;
    } catch (cause) {
      throw new StorageError("STORAGE_WRITE_FAILED", `S3 write failed for ${objectKey}`, cause);
    }
  };
  return {
    putSnapshot: (repositoryId, snapshotVersion, body) =>
      put(s3Keys.snapshot(repositoryId, snapshotVersion), body),
    putRawArtifact: (repositoryId, artifactPath, body) =>
      put(s3Keys.rawArtifact(repositoryId, artifactPath), body),
    putChunk: (repositoryId, chunkId, body) => put(s3Keys.chunk(repositoryId, chunkId), body),
    get: async (objectKey) => {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: options.bucketName, Key: objectKey }),
        );
        return bodyBytes(result.Body);
      } catch (cause) {
        throw new StorageError("STORAGE_READ_FAILED", `S3 read failed for ${objectKey}`, cause);
      }
    },
  };
}
