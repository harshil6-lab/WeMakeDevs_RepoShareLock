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

No Lambda functions or user authentication resources are deployed by the foundation stack; the Packet 12 application stack (`infrastructure/cloudformation/app.yaml`) adds the function, the API integration and Cognito. The application uses Bedrock through the runtime `Converse` API when deployed with credentials; Cognito + GitHub OAuth remains the approved authentication boundary.

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
## Packet 11 testing, security and hardening

The suite runs entirely in process with mocks only at the external boundaries (GitHub, DynamoDB/S3, Bedrock), so it needs no AWS, network or credentials and is deterministic. `npm test` runs 16 files / 84 tests.

| Area                  | File                            | Covers                                                                                              |
| --------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| API validation        | `tests/api.test.ts`             | request schema, 202 queued response, status vs result reads, stable error envelope                  |
| Storage               | `tests/storage.test.ts`         | DynamoDB investigations lifecycle, pagination, S3 put/get                                           |
| GitHub                | `tests/github.test.ts`          | real-shaped responses, pagination, bounded retry                                                    |
| Retrieval             | `tests/retrieval.test.ts`       | chunking, embedding determinism/normalization, hybrid ranking, repository isolation                 |
| Agent                 | `tests/engine.test.ts`          | tool input validation, provenance, bounded orchestration, structured output                         |
| Agent safety          | `tests/agent-safety.test.ts`    | iteration/tool/chunk/token/timeout bounds, tool failure, empty retrieval, invalid/duplicate evidence |
| Prompt injection      | `tests/prompt-injection.test.ts` | untrusted-data framing, tool allowlist, fabrication rejection, log hygiene                          |
| Integration           | `tests/integration.test.ts`     | API->DynamoDB, API->GitHub, ingestion->S3/metadata, retrieval->chunks, agent->Bedrock, worker->DB   |
| Golden investigation  | `tests/golden/e2e.test.ts`      | the complete golden path and expected answer                                                        |
| Frontend flow         | `tests/frontend-flow.test.ts`   | real `apiClient` + view models: login, repository, issue, investigate, progress, result, WHY, code   |
| Resilience / failures | `tests/resilience.test.ts`      | GitHub rate limit/unavailable, not indexed, empty repo, Bedrock error, timeout, DB/S3, network      |
| Security              | `tests/security.test.ts`        | committed-secret scan and CloudFormation least-privilege assertions (fallback for gitleaks/trivy)   |

### Bounded asynchronous dispatch

`src/api/worker.ts` retries asynchronous dispatch with a small bounded backoff (`maxAsyncAttempts`, default 3, clamped to `[1, 5]`) and logs `investigation_async_retry` and `investigation_async_invocation_failed`. Re-delivery is safe because `claimQueued` only claims work that is still `queued`, so a retry can never start a second run. `tests/resilience.test.ts` asserts both the retry and the no-duplicate guarantee.

## Packet 12 AWS production / demo deployment

### Target architecture

| Layer         | Service                                                            |
| ------------- | ------------------------------------------------------------------ |
| Frontend      | S3 (static assets) + CloudFront                                    |
| API           | API Gateway (HTTP API, `$default` route) → Lambda                  |
| Data          | DynamoDB (`InvestigationsTable`) + S3 (`ArtifactsBucket`)          |
| AI            | Amazon Bedrock Runtime (`Converse`)                                |
| Authentication| Existing GitHub session boundary; Cognito User Pool provisioned as the approved configuration |
| Observability | CloudWatch Logs + CloudWatch metrics                               |

### Infrastructure as code

All deployable infrastructure is CloudFormation under `infrastructure/cloudformation`:

- `template.yaml` — foundation stack: artifacts bucket, frontend bucket, DynamoDB table, GitHub secret, Lambda execution role, API Gateway HTTP API + stage, and both CloudWatch log groups.
- `app.yaml` — application stack: the RepoSherlock Lambda, the API Gateway Lambda integration and `$default` route, the CloudFront distribution (API + S3 origins), the frontend bucket policy (OAC), the Cognito user pool/client/domain, and the monthly budget.

Both templates take `ProjectName` and `EnvironmentName`, derive every resource name from them, and emit outputs consumed by the next stage (`ApiId`, `ArtifactsBucketName`, `FrontendBucketName`, `InvestigationsTableName`, `LambdaExecutionRoleArn`, `FrontendUrl`, `DistributionId`, `ApiEndpoint`, `FunctionName`). The region is always the deploy region (`ap-south-1` by default) and is never hardcoded in a resource ARN. `scripts/validate-templates.py` and `cfn-lint` validate both templates; `cfn-lint` exits clean.

Deployment order is enforced by the scripts, not by manual steps:

1. Deploy the foundation stack.
2. Read its outputs (buckets, table, role ARN, API id).
3. Store the GitHub token in Secrets Manager (never committed).
4. Build and upload the Lambda package to the artifacts bucket.
5. Deploy the application stack with the foundation outputs.
6. Sync frontend assets to the frontend bucket and invalidate CloudFront.

### Lambda build and packaging

The default Vite/Nitro preset (`cloudflare-module`) is untouched. `vite.config.aws.ts` runs Nitro with the `aws-lambda` preset into `.output-aws`, and `scripts/build-lambda.mjs` bundles `src/aws/lambda-handler.ts` with esbuild into `dist-lambda/index.mjs` and copies the Nitro server under `dist-lambda/server/`. The package is zipped and uploaded to `s3://<artifacts-bucket>/deploy/<revision>-<timestamp>/lambda.zip`.

`src/aws/lambda-handler.ts` is the single Lambda entry point. An `ApiGatewayV2`/ALB HTTP event is delegated to the Nitro server bundle; a payload carrying `marker: "reposherlock.async"` runs the asynchronous worker or indexer directly.

### Asynchronous investigation on Lambda

In-process `setTimeout` cannot survive a frozen Lambda. `src/api/composition.ts` gains an `AsyncDispatcher`; when `REPOSHERLOCK_ASYNC_FUNCTION_NAME` (or `AWS_LAMBDA_FUNCTION_NAME`) is set, the worker and the indexer self-invoke the function with `InvocationType: "Event"` through `@aws-sdk/client-lambda`, passing the marked payload. Without those variables (local development and tests) the work still runs in-process, so behaviour is unchanged. `enqueue`/`startIndex` are awaited so the freeze cannot drop an invocation that was scheduled but not yet sent. Re-delivery is safe because `claimQueued` claims only still-`queued` work, so a retry cannot start a second run.

### Lambda configuration

| Setting      | Value             | Rationale                                                       |
| ------------ | ----------------- | -------------------------------------------------------------- |
| Runtime      | `nodejs22.x`      | Supported runtime matching the Node 20+ target of the bundle.   |
| Architecture | `arm64`           | Lower cost for the demo workload.                              |
| Memory       | `1024 MB`         | Headroom for ingestion and the bounded agent.                  |
| Timeout      | `300 s`           | Bounded agent run is 30 s; timeout is not set close to it.     |
| Handler      | `index.handler`   | esbuild bundle root.                                           |

Environment: `REPOSHERLOCK_TABLE_NAME`, `REPOSHERLOCK_BUCKET_NAME`, `REPOSHERLOCK_BEDROCK_MODEL_ID`, `REPOSHERLOCK_BEDROCK_MAX_TOKENS`, `REPOSHERLOCK_ASYNC_FUNCTION_NAME`, `REPOSHERLOCK_LOG_LEVEL`, `REPOSHERLOCK_GITHUB_TOKEN`. The token is injected as `{{resolve:secretsmanager:...}}` at deploy time; no secret is committed to the repository or baked into the build.

### API, CORS and routing

The HTTP API uses a single `$default` route with an `AWS_PROXY` integration to the Lambda and a 30 s integration timeout. CloudFront's default cache behavior targets the API origin (so `/api/*` and SSR pages reach the Lambda through API Gateway) and forwards all viewer headers except `Host`. `/assets/*`, `/favicon.ico` and `/robots.txt` are served from the S3 frontend bucket with CachingOptimized, so the client bundle never hits the Lambda. The frontend uses the relative `/api` base, so no cross-origin configuration is required and the router never emits a wildcard `Access-Control-Allow-Origin`.

### S3, DynamoDB and Bedrock

- Both buckets are AES256-encrypted with full public-access blocking; the frontend bucket is readable only by the distribution through an Origin Access Control.
- The DynamoDB schema is unchanged: the foundation stack deploys the existing table and GSI exactly as before.
- Bedrock uses the runtime `Converse` API in `ap-south-1` with the configured model id and `maxTokens <= 1200`. The IAM policy is scoped to `bedrock:InvokeModel` on the foundation-model ARN list parameter; the runtime model id and the IAM foundation-model ARN remain separate and the model id is never hardcoded into the ARN.

### Observability and cost

`ApiAccessLogGroup` (`/aws/apigateway/...`) and `LambdaLogGroup` (`/aws/lambda/<project>-<env>`, 30-day retention) capture API and Lambda logs. Structured logs carry `investigationId`, `repositoryId`, `issueNumber`, `stage`, `toolName`, `durationMs` and `success`, and never log tokens, credentials or secrets. A monthly `COST` budget (default 20 USD, optional email) alerts at 80% actual spend; there is no always-on compute beyond the request-driven Lambda.

### Commands

```powershell
npm.cmd run build:aws           # build the Lambda package
npm.cmd run deploy              # deploy foundation + app + frontend (scripts/deploy.ps1)
npm.cmd run rollback            # redeploy the previous Lambda package (scripts/rollback.ps1)
python scripts/validate-templates.py
cfn-lint infrastructure/cloudformation/template.yaml infrastructure/cloudformation/app.yaml
```