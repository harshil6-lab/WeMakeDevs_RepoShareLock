import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { indexKeys, tableKeys } from "./keys";
import { StorageError } from "./errors";
import type {
  EvidenceRecord,
  CommitMetadataRecord,
  IndexingStatus,
  InvestigationRecord,
  InvestigationStage,
  InvestigationStatus,
  IssueMetadataRecord,
  Page,
  RepositoryChunkRecord,
  RepositoryFileRecord,
  RepositoryRecord,
  RepositoryStore,
  UserRecord,
} from "./types";

type DocumentClient = Pick<DynamoDBDocumentClient, "send">;
type DynamoItem = Record<string, unknown>;

export type DynamoRepositoryOptions = {
  tableName: string;
  client?: DocumentClient;
};

const encodeToken = (key?: Record<string, unknown>) =>
  key ? Buffer.from(JSON.stringify(key), "utf8").toString("base64url") : undefined;
const decodeToken = (token?: string) =>
  token
    ? (JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Record<string, unknown>)
    : undefined;
const pageLimit = (limit = 25) => Math.min(Math.max(limit, 1), 100);

type DynamoErrorMetadata = {
  httpStatusCode?: number;
  requestId?: string;
  extendedRequestId?: string;
  attempts?: number;
  totalRetryDelay?: number;
};

/** Reads the SDK error metadata without touching request parameters or item data. */
function readDynamoErrorMetadata(cause: unknown): DynamoErrorMetadata {
  if (!cause || typeof cause !== "object") return {};
  const metadata = (cause as { $metadata?: unknown }).$metadata;
  if (!metadata || typeof metadata !== "object") return {};
  const source = metadata as Record<string, unknown>;
  const result: DynamoErrorMetadata = {};
  const httpStatusCode = source["httpStatusCode"];
  if (typeof httpStatusCode === "number") result.httpStatusCode = httpStatusCode;
  const requestId = source["requestId"];
  if (typeof requestId === "string") result.requestId = requestId;
  const extendedRequestId = source["extendedRequestId"];
  if (typeof extendedRequestId === "string") result.extendedRequestId = extendedRequestId;
  const attempts = source["attempts"];
  if (typeof attempts === "number") result.attempts = attempts;
  const totalRetryDelay = source["totalRetryDelay"];
  if (typeof totalRetryDelay === "number") result.totalRetryDelay = totalRetryDelay;
  return result;
}

/**
 * Logs the underlying DynamoDB failure before it is wrapped. Only the error
 * name, message, and SDK metadata (status code, request ids, retry counters) are
 * recorded; request parameters, item contents, and credentials are never logged.
 */
function logDynamoFailure(operation: string, cause: unknown): void {
  const error = cause instanceof Error ? cause : undefined;
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      message: "storage_operation_failed",
      operation,
      cause: {
        name: error?.name ?? typeof cause,
        message: error?.message ?? String(cause),
      },
      metadata: readDynamoErrorMetadata(cause),
    }),
  );
}

function withError<T>(operation: string, action: () => Promise<T>): Promise<T> {
  return action().catch((cause) => {
    logDynamoFailure(operation, cause);
    throw new StorageError(
      operation.includes("read") || operation.includes("list")
        ? "STORAGE_READ_FAILED"
        : "STORAGE_WRITE_FAILED",
      `${operation} failed`,
      cause,
    );
  });
}

function page<T>(items: T[], lastEvaluatedKey?: Record<string, unknown>): Page<T> {
  const nextToken = encodeToken(lastEvaluatedKey);
  return nextToken ? { items, nextToken } : { items };
}

export function createDynamoRepository(options: DynamoRepositoryOptions): RepositoryStore {
  const client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const put = (item: DynamoItem) =>
    withError("write item", () =>
      client
        .send(new PutCommand({ TableName: options.tableName, Item: item }))
        .then(() => undefined),
    );

  const users = {
    create: (record: UserRecord) =>
      put({ ...tableKeys.user(record.userId), entityType: "User", ...record }),
    get: (userId: string) =>
      withError("read user", async () => {
        const result = await client.send(
          new GetCommand({ TableName: options.tableName, Key: tableKeys.user(userId) }),
        );
        return result.Item as UserRecord | undefined;
      }),
    update: (record: UserRecord) =>
      put({ ...tableKeys.user(record.userId), entityType: "User", ...record }),
  };

  const repositories = {
    create: (record: RepositoryRecord) =>
      put({
        ...tableKeys.repository(record.repositoryId),
        ...indexKeys.userRepository(record.userId, record.repositoryId),
        entityType: "Repository",
        ...record,
      }),
    get: (repositoryId: string) =>
      withError("read repository", async () => {
        const result = await client.send(
          new GetCommand({ TableName: options.tableName, Key: tableKeys.repository(repositoryId) }),
        );
        return result.Item as RepositoryRecord | undefined;
      }),
    listForUser: (userId: string, nextToken?: string, limit?: number) =>
      withError("list repositories", async () => {
        const input: QueryCommandInput = {
          TableName: options.tableName,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
          ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":sk": "REPOSITORY#" },
          Limit: pageLimit(limit),
          ExclusiveStartKey: decodeToken(nextToken),
        };
        const result = await client.send(new QueryCommand(input));
        return page((result.Items ?? []) as RepositoryRecord[], result.LastEvaluatedKey);
      }),
    updateIndexingStatus: (repositoryId: string, status: IndexingStatus, updatedAt: string) =>
      withError("write repository status", () =>
        client
          .send(
            new UpdateCommand({
              TableName: options.tableName,
              Key: tableKeys.repository(repositoryId),
              UpdateExpression: "SET indexingStatus = :status, updatedAt = :updatedAt",
              ExpressionAttributeValues: { ":status": status, ":updatedAt": updatedAt },
            }),
          )
          .then(() => undefined),
      ),
  };

  const chunks = {
    put: (record: RepositoryChunkRecord) =>
      put({
        ...tableKeys.chunk(record.repositoryId, record.chunkId),
        entityType: "RepositoryChunk",
        ...record,
      }),
    listForRepository: (repositoryId: string, nextToken?: string, limit?: number) =>
      withError("list repository chunks", async () => {
        const result = await client.send(
          new QueryCommand({
            TableName: options.tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `REPOSITORY#${repositoryId}`, ":sk": "CHUNK#" },
            Limit: pageLimit(limit),
            ExclusiveStartKey: decodeToken(nextToken),
          }),
        );
        return page((result.Items ?? []) as RepositoryChunkRecord[], result.LastEvaluatedKey);
      }),
  };

  const files = {
    put: (record: RepositoryFileRecord) =>
      put({
        ...tableKeys.file(record.repositoryId, record.filePath),
        entityType: "RepositoryFile",
        ...record,
      }),
  };

  const commits = {
    put: (record: CommitMetadataRecord) =>
      put({
        ...tableKeys.commit(record.repositoryId, record.commitSha),
        entityType: "Commit",
        ...record,
      }),
  };

  const investigations = {
    create: (record: InvestigationRecord) =>
      put({
        ...tableKeys.investigation(record.investigationId),
        entityType: "Investigation",
        ...record,
      }),
    get: (investigationId: string) =>
      withError("read investigation", async () => {
        const result = await client.send(
          new GetCommand({
            TableName: options.tableName,
            Key: tableKeys.investigation(investigationId),
          }),
        );
        return result.Item as InvestigationRecord | undefined;
      }),
    updateStatus: (investigationId: string, status: InvestigationStatus, updatedAt: string) =>
      withError("write investigation status", () =>
        client
          .send(
            new UpdateCommand({
              TableName: options.tableName,
              Key: tableKeys.investigation(investigationId),
              UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: { ":status": status, ":updatedAt": updatedAt },
            }),
          )
          .then(() => undefined),
      ),
    claimQueued: async (investigationId: string, startedAt: string, updatedAt: string) => {
      try {
        await client.send(
          new UpdateCommand({
            TableName: options.tableName,
            Key: tableKeys.investigation(investigationId),
            ConditionExpression: "#status = :queued",
            UpdateExpression:
              "SET #status = :running, startedAt = :startedAt, updatedAt = :updatedAt",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":queued": "queued",
              ":running": "running",
              ":startedAt": startedAt,
              ":updatedAt": updatedAt,
            },
          }),
        );
        return true;
      } catch (cause) {
        if (cause instanceof Error && cause.name === "ConditionalCheckFailedException")
          return false;
        throw new StorageError("STORAGE_WRITE_FAILED", "claim investigation failed", cause);
      }
    },
    updateProgress: (
      investigationId: string,
      stage: InvestigationStage,
      progress: number,
      updatedAt: string,
    ) =>
      withError("write investigation progress", () =>
        client
          .send(
            new UpdateCommand({
              TableName: options.tableName,
              Key: tableKeys.investigation(investigationId),
              ConditionExpression: "#status = :running",
              UpdateExpression:
                "SET currentStage = :stage, progress = :progress, updatedAt = :updatedAt",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":running": "running",
                ":stage": stage,
                ":progress": progress,
                ":updatedAt": updatedAt,
              },
            }),
          )
          .then(() => undefined),
      ),
    complete: (
      investigationId: string,
      result: Record<string, unknown>,
      completedAt: string,
      durationMs: number,
      updatedAt: string,
    ) =>
      withError("complete investigation", () =>
        client
          .send(
            new UpdateCommand({
              TableName: options.tableName,
              Key: tableKeys.investigation(investigationId),
              ConditionExpression: "#status = :running",
              UpdateExpression:
                "SET #status = :completed, currentStage = :stage, progress = :progress, result = :result, completedAt = :completedAt, durationMs = :durationMs, updatedAt = :updatedAt REMOVE #error, failureCode",
              ExpressionAttributeNames: { "#status": "status", "#error": "error" },
              ExpressionAttributeValues: {
                ":running": "running",
                ":completed": "completed",
                ":stage": "completed",
                ":progress": 100,
                ":result": result,
                ":completedAt": completedAt,
                ":durationMs": durationMs,
                ":updatedAt": updatedAt,
              },
            }),
          )
          .then(() => undefined),
      ),
    fail: (
      investigationId: string,
      status: "failed" | "timeout",
      failureCode: string,
      error: string,
      completedAt: string,
      durationMs: number,
      updatedAt: string,
    ) =>
      withError("fail investigation", () =>
        client
          .send(
            new UpdateCommand({
              TableName: options.tableName,
              Key: tableKeys.investigation(investigationId),
              ConditionExpression: "#status = :running",
              UpdateExpression:
                "SET #status = :status, #error = :error, failureCode = :failureCode, completedAt = :completedAt, durationMs = :durationMs, updatedAt = :updatedAt",
              ExpressionAttributeNames: { "#status": "status", "#error": "error" },
              ExpressionAttributeValues: {
                ":running": "running",
                ":status": status,
                ":error": error.slice(0, 1000),
                ":failureCode": failureCode,
                ":completedAt": completedAt,
                ":durationMs": durationMs,
                ":updatedAt": updatedAt,
              },
            }),
          )
          .then(() => undefined),
      ),
  };

  const evidence = {
    put: (record: EvidenceRecord) =>
      put({
        ...tableKeys.evidence(record.investigationId, record.evidenceId),
        entityType: "Evidence",
        ...record,
      }),
    listForInvestigation: (investigationId: string, nextToken?: string, limit?: number) =>
      withError("list investigation evidence", async () => {
        const result = await client.send(
          new QueryCommand({
            TableName: options.tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
              ":pk": `INVESTIGATION#${investigationId}`,
              ":sk": "EVIDENCE#",
            },
            Limit: pageLimit(limit),
            ExclusiveStartKey: decodeToken(nextToken),
          }),
        );
        return page((result.Items ?? []) as EvidenceRecord[], result.LastEvaluatedKey);
      }),
  };

  const issues = {
    put: (record: IssueMetadataRecord) =>
      put({
        ...tableKeys.issue(record.repositoryId, record.issueNumber),
        entityType: "IssueMetadata",
        ...record,
      }),
    get: (repositoryId: string, issueNumber: number) =>
      withError("read issue metadata", async () => {
        const result = await client.send(
          new GetCommand({
            TableName: options.tableName,
            Key: tableKeys.issue(repositoryId, issueNumber),
          }),
        );
        return result.Item as IssueMetadataRecord | undefined;
      }),
    listForRepository: (repositoryId: string, nextToken?: string, limit?: number) =>
      withError("list repository issues", async () => {
        const result = await client.send(
          new QueryCommand({
            TableName: options.tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `REPOSITORY#${repositoryId}`, ":sk": "ISSUE#" },
            Limit: pageLimit(limit),
            ExclusiveStartKey: decodeToken(nextToken),
          }),
        );
        return page((result.Items ?? []) as IssueMetadataRecord[], result.LastEvaluatedKey);
      }),
  };

  return { users, repositories, chunks, files, commits, investigations, evidence, issues };
}

export { DeleteCommand };
