# API flow

## AWS foundation flow

```mermaid
flowchart LR
  Client[API client] --> ApiGateway[API Gateway HTTP API]
  ApiGateway --> Lambda[RepoSherlock Lambda]
  Lambda --> DDB[(DynamoDB investigations)]
  Lambda --> S3[(S3 artifacts)]
  Lambda --> Secrets[Secrets Manager]
  Lambda --> Bedrock[Bedrock model invocation]
  ApiGateway --> ApiLogs[CloudWatch API access logs]
  Lambda --> LambdaLogs[CloudWatch Lambda logs]
```

The foundation stack creates the API boundary and the least-privilege execution role. The application stack (Packet 12) attaches the Lambda integration to the same API and puts CloudFront in front of it.

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
## Packet 11 failure and retry flow

```mermaid
flowchart TD
  POST[POST /investigations] --> Persist[persist queued]
  Persist --> Reply[202 queued]
  Persist --> Dispatch[bounded async dispatch]
  Dispatch -->|rejects| Retry[retry with backoff, max 3]
  Retry -->|budget exhausted| LogFail[log async invocation failed]
  Dispatch -->|resolves| Handle[worker.handle]
  Handle -->|already claimed| Stop[no-op, no duplicate run]
  Handle -->|still queued| Claim[claimQueued]
  Claim --> Run[runInvestigation]
  Run -->|completed with unique evidence| Complete[persist completed]
  Run -->|timeout or error| Failed[persist failed or timeout with failureCode]
```

Every external boundary has a controlled outcome: GitHub rate limit (`GITHUB_RATE_LIMITED`), GitHub unavailable (`GITHUB_REQUEST_FAILED`), repository not indexed (`REPOSITORY_NOT_INDEXED`), empty repository (zero files/issues and still `completed`), Bedrock error (`BEDROCK_ERROR`), investigation timeout (`INVESTIGATION_TIMEOUT`), DynamoDB/S3 failures (`StorageError` surfaced as a controlled API 500), and frontend network failure (`ApiClientError` with `NETWORK_ERROR`). Agent bounds always terminate the run: exhausted tool or token budgets, an unresponsive Bedrock call, malformed model JSON, and unresolved or duplicated evidence ids all produce a validated `failed` result instead of an infinite loop or fabricated evidence.

## Packet 12 deployment and request flow

```mermaid
flowchart TD
  Dev[Developer] -->|scripts/deploy.ps1| Foundation[Foundation stack]
  Foundation --> Buckets[Artifacts + frontend buckets]
  Foundation --> Table[InvestigationsTable]
  Foundation --> Role[Lambda execution role]
  Foundation --> HttpApi[HTTP API + stage]
  Dev -->|build:aws| Package[dist-lambda.zip]
  Package -->|s3 cp| Buckets
  Foundation --> Secret[Secrets Manager GitHub token]
  Buckets --> App[Application stack]
  HttpApi --> App
  App --> Lambda[RepoSherlock Lambda]
  App --> CloudFront[CloudFront distribution]
  CloudFront -->|default| HttpApi
  CloudFront -->|/assets/*| Buckets
  App --> Cognito[Cognito user pool]
  App --> Budget[Monthly cost budget]
```

```mermaid
sequenceDiagram
  participant User
  participant CF as CloudFront
  participant APIGW as API Gateway
  participant L as Lambda
  participant SM as Secrets Manager
  participant Bedrock
  User->>CF: GET https://<dist>/
  CF->>APIGW: default behavior (SSR + /api)
  APIGW->>L: AWS_PROXY $default
  L->>L: render frontend / handle API
  User->>CF: POST /api/investigations
  CF->>APIGW: forward (AllViewerExceptHost)
  APIGW->>L: invoke
  L-->>User: 202 investigationId (queued)
  L->>L: self-invoke (InvocationType Event, marker)
  L->>SM: resolve token at deploy time (env)
  L->>Bedrock: Converse (bounded tools)
  L->>L: evidence validation + persist
  User->>CF: GET /api/investigations/:id
  CF->>APIGW: forward
  APIGW->>L: invoke
  L-->>User: completed result with evidence
```

The deployment is two CloudFormation stacks. The foundation stack owns the data, secret, IAM role, HTTP API and log groups; the application stack consumes its outputs and adds the Lambda, the API integration, CloudFront, Cognito and the budget. Data resources are `Retain`-protected, so deleting a stack never destroys the buckets, table or secret.

At runtime CloudFront is the single public entry point. The default behavior proxies `/api/*` and SSR pages to API Gateway → Lambda; `/assets/*` and the static root files are served directly from the S3 frontend bucket through an Origin Access Control. Because the browser calls the relative `/api` base on the CloudFront domain, requests stay same-origin and no wildcard CORS header is emitted.

Long investigations run asynchronously: the API returns `202` with an `investigationId`, then the Lambda self-invokes itself with `InvocationType: "Event"` and the `reposherlock.async` marker. A client that retries the same event cannot start a second run because claiming is conditional on `queued`. The Lambda timeout (300 s) leaves generous headroom over the bounded agent timeout (30 s).

The Bedrock boundary returns plain text: `createBedrockModel` joins every text block of the Converse response (`output.message.content` is an ordered `ContentBlock[]`) instead of only the first, so a reasoning block cannot hide the claims envelope. `parseModelJson` then returns the first JSON candidate that satisfies `claimsSchema`, including JSON nested in object or array string values. A response with no schema-valid object still fails as `INVALID_AGENT_RESULT`; no claim is invented.

## Packet 14 timeout and terminal state

```mermaid
sequenceDiagram
  participant W as Worker
  participant E as Engine (run())
  participant D as DynamoDB
  W->>D: claimQueued (status = running)
  W->>E: race(run(), 30 s timeout)
  E->>D: updateProgress per stage (condition status = running)
  Note over E: SYNTHESIZE completes after the 30 s bound
  W->>D: timeout wins -> fail(status = timeout, condition status = running)
  E-->>E: cancelled = true, stage() becomes a no-op
  Note over D: the late progress write is dropped, never applied
  W-->>W: terminal write returns false -> skipped log
```

The timeout path only terminates the record while it is still `running`; the abandoned run stops reporting stages once the flag is set, and any write that still loses the condition is dropped at the storage boundary instead of throwing. Exactly one terminal state (`completed`, `failed` or `timeout`) is ever persisted, and the timeout protection is not removed or extended.
