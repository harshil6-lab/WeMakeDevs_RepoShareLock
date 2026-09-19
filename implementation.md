# RepoSherlock implementation

RepoSherlock exposes a small fetch-based API router mounted before TanStack SSR.
Zod owns request and response validation. The investigation service uses an in-memory store for the hackathon and accepts an injected worker so GitHub ingestion and investigation execution can be connected later.

`POST /api/investigations` validates input, persists a queued record, invokes the worker mechanism, and returns `202` without waiting for investigation work. `GET /api/investigations/:investigationId` reads the current record. `GET /api/health` reports service availability.

## AWS foundation

`infrastructure/cloudformation/template.yaml` provisions the approved MVP foundation only:

- Encrypted, private, versioned S3 artifacts storage.
- On-demand DynamoDB investigations table with point-in-time recovery.
- A Lambda execution role scoped to the bucket, table, GitHub secret, CloudWatch logs, and explicitly supplied Bedrock model ARNs.
- An API Gateway HTTP API and default stage with access logging, intentionally without application integrations.
- Retained CloudWatch log groups with 30-day retention.
- A retained Secrets Manager secret shell for the future GitHub integration. No token is placed in IaC.

No Lambda functions or user authentication resources are deployed by the foundation stack. The application uses Bedrock through the runtime `Converse` API when deployed with credentials; Cognito + GitHub OAuth remains the approved authentication boundary and is configured manually as documented below.

## Storage layer

The storage boundary is under `src/storage`. Business logic depends on `RepositoryStore` and `ArtifactRepository`, never on AWS SDK commands. AWS adapters are isolated in `dynamo-repository.ts` and `s3-repository.ts`; tests inject a client port and do not require AWS credentials.

DynamoDB uses one table with `PK`, `SK`, `GSI1PK`, and `GSI1SK`. Every stored record includes `entityType` and ISO-8601 timestamps. Pagination uses an opaque base64url `nextToken` derived from DynamoDB's `LastEvaluatedKey`; limits are clamped to 1-100.

### DynamoDB access patterns

| Entity/access pattern              | Key condition                                                      | Operation          |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------ |
| Get User                           | `PK=USER#{userId}`, `SK=PROFILE`                                   | GetItem            |
| Create/update User                 | `PK=USER#{userId}`, `SK=PROFILE`                                   | PutItem            |
| Get Repository                     | `PK=REPOSITORY#{repositoryId}`, `SK=METADATA`                      | GetItem            |
| List repositories for user         | `GSI1PK=USER#{userId}`, `begins_with(GSI1SK, REPOSITORY#)`         | Query, paginated   |
| Update repository indexing status  | Repository metadata key                                            | UpdateItem         |
| List RepositoryChunk metadata      | `PK=REPOSITORY#{repositoryId}`, `begins_with(SK, CHUNK#)`          | Query, paginated   |
| Get Investigation                  | `PK=INVESTIGATION#{investigationId}`, `SK=METADATA`                | GetItem            |
| Create/update Investigation status | Investigation metadata key                                         | PutItem/UpdateItem |
| List Evidence for investigation    | `PK=INVESTIGATION#{investigationId}`, `begins_with(SK, EVIDENCE#)` | Query, paginated   |
| Get/put Issue metadata             | `PK=REPOSITORY#{repositoryId}`, `SK=ISSUE#{issueNumber}`           | GetItem/PutItem    |

### S3 prefixes

- `repositories/{repositoryId}/snapshots/{snapshotVersion}/snapshot.tar.gz`: immutable repository snapshots.
- `repositories/{repositoryId}/raw/{artifactPath}`: raw repository files and ingestion artifacts.
- `repositories/{repositoryId}/chunks/{chunkId}.json`: optional serialized chunk artifacts.

## Repository retrieval MVP

`src/retrieval/index.ts` is the approved local MVP retrieval boundary. Ingestion filters supported source files and excludes generated/vendor paths, detects language from the extension, chunks by configurable line windows with overlap, and stores each serialized chunk in S3. DynamoDB stores the chunk provenance, content hash, commit SHA, and a deterministic 64-dimensional hashed-token embedding.

Retrieval queries only the requested repository's chunk partition. It computes cosine similarity and keyword overlap, combines them into a deterministic score, applies a configurable threshold, sorts by score, and returns `topK` results. Every result includes `repositoryId`, `filePath`, `startLine`, `endLine`, `commitSha`, `chunkId`, and `language`.

This deliberately uses the existing S3 and DynamoDB adapters. It does not create OpenSearch or a dedicated vector database, and it does not require model credentials for local development.

## Investigation engine

`src/investigation/engine.ts` implements one bounded orchestrator with the phases `PLAN`, `SEARCH`, `RETRIEVE`, `ANALYZE`, `HYPOTHESIZE`, `VERIFY`, `SYNTHESIZE`, and `VALIDATE`. It uses the Bedrock runtime `Converse` API through the injected `BedrockModel` adapter in `src/investigation/bedrock.ts`. There is no multi-agent delegation.

The tool registry exposes typed Zod input/output contracts for `searchRepository`, `readFile`, `searchGitHistory`, `getCommit`, `searchRelatedIssues`, `buildEvidence`, and `generateInvestigation`. Each tool validates inputs, caps returned data, handles only repository-scoped context, and returns resolved provenance. Repository data is placed between data delimiters in the model prompt and is explicitly treated as untrusted data, never instructions.

The default hard limits are eight iterations, 20 tool calls, 24 retrieved chunks, a 6,000-token output budget, and a 30-second timeout. The implementation clamps caller-provided limits to safe maxima. A tool, Bedrock, parse, timeout, isolation, or evidence failure returns a validated `status: "failed"` result with no claims rather than fabricating a partial conclusion.

The critical evidence rule is enforced twice: `buildEvidence` can only resolve IDs already returned by tools, and `generateInvestigation` rejects claims whose evidence IDs are absent from the ledger. A completed investigation therefore contains only claims with at least one resolved repository file, commit, issue, pull request, or documentation provenance item.

## Packet 08 worker lifecycle

`src/api/worker.ts` is the asynchronous entry point. `enqueue` accepts only an investigation ID event and invokes `handle` through an injected async invoker; the local default defers with `setTimeout`, while a Lambda deployment can provide its native asynchronous invocation adapter. The worker never duplicates agent logic: it calls `runInvestigation` and supplies the stage callback.

The lifecycle is persisted in the existing investigation partition. Creation writes `queued` and `progress: 0`; `claimQueued` conditionally changes exactly one worker to `running`; stage callbacks persist `currentStage`, progress, and timestamps; a validated result writes `completed`, `completed`, `100`, result, duration, and completion time. Failures write `failed` or `timeout`, a stable failure code, a safe public error, duration, and completion time.

Conditional DynamoDB updates prevent duplicate events and stale workers from completing terminal records. The status endpoint is `GET /api/investigations/{id}/status`; the result/lifecycle endpoint is `GET /api/investigations/{id}`. The API service can use the existing `RepositoryStore` through `createInvestigationService(worker, { storage })`; no second database is introduced.

## Packet 09 frontend integration

`src/api/client.ts` is the single browser HTTP boundary. It validates every response with Zod, applies a 15-second request timeout, maps API/network failures to safe client errors, and uses only `VITE_API_BASE_URL` as public configuration. UI components do not call `fetch` directly.

The existing presentation state machine now loads repositories and issues from the frozen resource paths, preserves `repositoryId` and `issueNumber`, starts indexing, polls index status, creates investigations, polls investigation status, loads the completed result, and loads evidence provenance for WHY. Backend stages drive the existing investigation animation; no elapsed-time progress is fabricated. Impact and fix-plan panels show honest empty states when the validated result does not contain those fields.

`src/api/resources.ts` adapts the frozen repository/index/issue/evidence paths to the existing DynamoDB/GitHub ports. The adapter is injected into `createApiRouter`; it does not introduce another persistence layer or service.

## GitHub integration and ingestion

`src/github/client.ts` is a response-validated GitHub REST client. It supports accessible repository listing, repository and issue details, recursive Git tree metadata, Contents API file reads, tarball archive downloads, commits, and Search API related issue/PR metadata. It uses a bounded retry budget, rate-limit reset handling capped at 10 seconds per wait, a maximum of 25 pages, and 100 items per page. Tokens are supplied through `GitHubTokenProvider` and are never logged.

`src/github/ingestion.ts` gets the real repository response, refuses truncated trees, stores the GitHub tarball under the repository snapshot prefix, filters supported source files, stores raw files in S3, writes file metadata and commit metadata, and stores non-PR issue metadata. It caps files at 100 and file size at 512 KB by default. It does not modify source code, create branches, or create pull requests.

## Packet 10 golden end-to-end investigation

`tests/fixtures/golden-repository/` is the golden dataset: a real, inspectable five-file repository (`acme/payments-service`) that contains the actual implementation behind issue #1842. `tests/fixtures/golden-repository.fixture.ts` derives every locator from that content — blob ids use Git's own `sha1("blob <byteLength>\0" + content)` formula — so no path, sha, issue or PR in the golden answer is invented. The same module records the expected answer: relevant file, function, commit, related PR, root-cause concept and expected evidence sources.

`tests/golden/e2e.test.ts` runs the complete path in process against the real router, resource adapter, service, worker, agent, retrieval and evidence validator, replacing only the external boundaries with fixture doubles:

- `tests/golden/golden-github-client.ts` serves the fixture over the `GitHubClient` contract and throws for an unknown owner, path, ref or sha.
- `tests/golden/in-memory-store.ts` implements the storage ports with the same conditional lifecycle semantics as DynamoDB.
- `tests/golden/golden-model.ts` is a deterministic Bedrock double that cites only evidence ids present in the prompt, and yields like a network call so lifecycle transitions stay observable.

The test drives HTTP requests: authenticate, connect and list the golden repository, index it, poll index status, list issues, select #1842, create the investigation, poll status, read the result and read evidence. It then asserts the golden expectations, that every evidence locator resolves, that every claim cites resolved evidence, and that the frontend mappers produce a real structured investigation.

### Composition root

`src/api/composition.ts` wires the existing components (DynamoDB store, S3 artifacts, GitHub client, retrieval, worker, Bedrock) into the existing fetch router and accepts overrides for every port. When required configuration is missing it logs `api_not_configured` and returns `undefined`, so `src/server.ts` falls back to the minimal router and local development keeps working. No queue, orchestrator, second database or new service is introduced.

### Golden-path corrections

Three components needed a bounded correction before the golden investigation could succeed:

- Retrieval applies a deterministic primary-source weight (prose/markdown x0.75) so the implementation file that causes the defect outranks a README or runbook that merely repeats the symptom wording.
- Git history search ranks commits by keyword agreement with the issue instead of requiring the issue title as an exact substring, which real commit messages do not contain.
- The synthesis prompt now includes the resolved evidence excerpts, so the model can only synthesise claims about evidence the tools actually returned.

### Observability

The worker logs `investigation_started`, `investigation_stage_updated`, `investigation_completed` and `investigation_failed`; the engine logs `investigation_tool_call` and `investigation_bedrock_call`. Every entry carries `investigationId`, `repositoryId` and `issueNumber`, plus the stage or the `toolName`/`phase`, `durationMs` and `success`. Repository content, prompts, tokens and credentials are never logged.

### Not implemented

Impact and fix-plan sections are not part of the validated result contract. The UI renders honest empty states and the golden test asserts that no `impact` or `fixPlan` field is fabricated.