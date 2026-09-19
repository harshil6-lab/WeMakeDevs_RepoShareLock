# API flow

## AWS foundation flow

```mermaid
flowchart LR
  Client[API client] --> ApiGateway[API Gateway HTTP API]
  ApiGateway -. no integration yet .-> Lambda[Future Lambda handlers]
  Lambda --> DDB[(DynamoDB investigations)]
  Lambda --> S3[(S3 artifacts)]
  Lambda --> Secrets[Secrets Manager]
  Lambda --> Bedrock[Bedrock model invocation]
  ApiGateway --> ApiLogs[CloudWatch API access logs]
  Lambda --> LambdaLogs[CloudWatch Lambda logs]
```

The CloudFormation stack creates the boundary and least-privilege role now. Application integrations remain a later deployment step.

## Storage flow

```mermaid
sequenceDiagram
  Ingestion->>RepositoryStore: put Repository metadata
  RepositoryStore->>DynamoDB: PutItem(PK/SK)
  Ingestion->>ArtifactRepository: put snapshot/raw artifact
  ArtifactRepository->>S3: PutObject(repositories/{repositoryId}/...)
  Ingestion->>Retrieval: filter, detect language, chunk, embed
  Retrieval->>ArtifactRepository: put serialized chunks
  Retrieval->>RepositoryStore: put chunk metadata and embedding
  Investigation->>RepositoryStore: list evidence
  RepositoryStore->>DynamoDB: Query investigation partition
  DynamoDB-->>RepositoryStore: items + opaque nextToken
```

The repository interfaces own key construction, pagination translation, timestamps/status fields, and structured `StorageError` conversion. API handlers do not call DynamoDB or S3.

## GitHub authentication and ingestion flow

```mermaid
sequenceDiagram
  Developer->>Cognito: Sign in with GitHub OAuth
  Cognito-->>Frontend: Authenticated session/token
  Frontend->>GitHubClient: Request with injected access token
  GitHubClient->>GitHub: List repositories / metadata / issues / tree / commits
  GitHub-->>GitHubClient: Actual response-backed data
  GitHubClient->>S3: Store tarball snapshot and raw files
  GitHubClient->>RepositoryStore: Store file, commit, issue metadata
  RepositoryStore->>DynamoDB: PutItem / Query
```

Transient GitHub failures retry within a bounded budget. Rate limits use `Retry-After` or `X-RateLimit-Reset`, capped at 10 seconds per wait. A truncated tree, invalid payload, exhausted retry budget, or unsupported file size fails with a structured error rather than fabricated data.

```mermaid
sequenceDiagram
  Client->>API: POST /api/investigations
  API->>Schema: Validate repositoryId and issueNumber
  API->>Service: Create queued record
  Service->>Worker: enqueue(record)
  API-->>Client: 202 { investigationId, status: queued }
  Client->>API: GET /api/investigations/:id
  API->>Service: Read record
  Service-->>API: Stable investigation schema
  API-->>Client: 200 investigation status
```

## Repository retrieval flow

```mermaid
sequenceDiagram
  Query->>Retriever: repositoryId + query + config
  Retriever->>RepositoryStore: list chunks for repositoryId
  RepositoryStore-->>Retriever: provenance + embeddings
  Retriever->>ArtifactRepository: read candidate chunk content
  Retriever->>Retriever: semantic score + keyword score + rank
  Retriever-->>Query: topK provenance-bearing results
```

The repository partition is both the storage access pattern and the isolation boundary. Empty queries return no results; thresholding happens before ranking.

## Investigation engine flow

```mermaid
sequenceDiagram
  Worker->>Engine: repository + issue context
  Engine->>Bedrock: PLAN with untrusted-data system boundary
  Engine->>Tools: SEARCH / RETRIEVE
  Tools-->>Engine: bounded results + resolved provenance
  Engine->>Bedrock: ANALYZE / HYPOTHESIZE
  Engine->>Tools: VERIFY via history, commit, file, related issues
  Tools-->>Engine: evidence ledger entries
  Engine->>Bedrock: SYNTHESIZE claims with evidence IDs
  Engine->>Tools: buildEvidence and generateInvestigation
  Tools-->>Engine: validated structured result
```

The model never resolves a citation itself. `buildEvidence` resolves only IDs already present in the ledger, and `generateInvestigation` validates every claim before a completed result can be returned. Any limit or dependency failure produces a structured failed result.

## Packet 08 lifecycle

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> running: conditional worker claim
  running --> completed: validated result persisted
  running --> failed: controlled error persisted
  running --> timeout: bounded agent timeout persisted
  completed --> [*]
  failed --> [*]
  timeout --> [*]
```

```mermaid
sequenceDiagram
  Client->>API: POST /api/investigations
  API->>RepositoryStore: create queued record
  API->>AsyncInvoker: enqueue investigationId
  API-->>Client: 202 queued
  AsyncInvoker->>Worker: handle({ investigationId })
  Worker->>RepositoryStore: conditional queued -> running
  Worker->>Agent: runInvestigation(onStageChange)
  Agent->>Tools: bounded repository tools
  Tools->>Bedrock: Converse
  Agent-->>Worker: validated result or failure result
  Worker->>RepositoryStore: persist stages and completed/failed/timeout
  Client->>API: GET /api/investigations/{id}/status
  Client->>API: GET /api/investigations/{id}
```

The worker validates repository existence, completed indexing, and issue existence before invoking the agent. It logs structured identifiers and codes only; tokens, credentials, and repository dumps are never logged.

## Packet 09 frontend flow

```mermaid
sequenceDiagram
  Browser->>ApiClient: POST /auth/session
  Browser->>ApiClient: GET /repositories
  Browser->>ApiClient: POST /repositories/{id}/index
  loop until index terminal
    Browser->>ApiClient: GET /repositories/{id}/index-status
  end
  Browser->>ApiClient: GET /repositories/{id}/issues
  Browser->>ApiClient: POST /investigations
  loop until investigation terminal
    Browser->>ApiClient: GET /investigations/{id}/status
  end
  Browser->>ApiClient: GET /investigations/{id}
  Browser->>ApiClient: GET /investigations/{id}/evidence
```

The client validates response shapes and renders loading, empty, network, timeout, and terminal failure states. The main flow never falls back to `mock-data.ts`; mocks remain only as unused demo fixtures.

## Packet 10 golden path

```mermaid
sequenceDiagram
  participant Test as Golden harness
  participant API as createConfiguredApiRouter
  participant Res as RepositoryResourceService
  participant Ing as ingestRepository
  participant Store as DynamoDB/S3 ports
  participant Wk as Investigation worker
  participant Ag as Bounded agent
  participant BD as Bedrock Converse
  participant Val as Evidence validator
  participant UI as Frontend mappers
  Test->>API: POST /auth/session
  Test->>API: POST /repositories
  Test->>API: POST /repositories/{id}/index
  API->>Res: startIndex
  Res->>Ing: ingest the golden repository
  Ing->>Store: snapshot, raw files, chunks, commits, issues
  Test->>API: GET /repositories/{id}/index-status
  Test->>API: GET /repositories/{id}/issues
  Test->>API: POST /investigations
  API->>Store: persist queued investigation
  API-->>Test: 202 queued
  Wk->>Store: queued -> running
  Wk->>Ag: runInvestigation(onStageChange)
  Ag->>Store: bounded tool calls
  Ag->>BD: PLAN, ANALYZE, HYPOTHESIZE, SYNTHESIZE
  Ag->>Val: buildEvidence, generateInvestigation
  Val-->>Wk: validated result
  Wk->>Store: completed with result and duration
  Test->>API: GET /investigations/{id}/status
  Test->>API: GET /investigations/{id}
  Test->>API: GET /investigations/{id}/evidence
  Test->>UI: resultEvidence, toEvidenceView
```

The observed lifecycle is `queued -> running -> completed`. The complete stage order is asserted from structured logs and matches the state machine exactly: `understanding_issue`, `searching_repository`, `tracing_code`, `checking_history`, `finding_related_issues`, `forming_hypothesis`, `verifying_evidence`, `synthesizing`, `validating`, `completed`. The bounded tool sequence for one investigation is `searchRepository`, `readFile`, `searchGitHistory`, `getCommit`, `searchRelatedIssues`, then `buildEvidence` per claim.

```mermaid
flowchart LR
  Env[Runtime configuration] --> Compose[createConfiguredApiRouter]
  Compose -->|configured| Real[DynamoDB + S3 + GitHub + Bedrock adapters]
  Compose -->|missing configuration| Minimal[Minimal router fallback]
  Real --> Router[Existing fetch router]
  Minimal --> Router
```

`src/server.ts` resolves the composition root once per process. Missing configuration is a logged warning, never a crash.