# Decisions

## AWS foundation decisions

- Use AWS CloudFormation because it is available through the AWS Console and CLI without introducing a new local IaC runtime.
- Use `ap-south-1` as the documented default deployment region; all resources are created in the selected stack region.
- Use generated physical names by default to avoid collisions. An optional S3 bucket name and configurable secret name are exposed as parameters.
- Use an HTTP API as an unintegrated API Gateway front door. No application behavior is duplicated in infrastructure.
- Use an execution role instead of Lambda functions until application deployment is approved.
- Restrict Bedrock access to `bedrock:InvokeModel` and the model ARN list supplied at deployment time.
- Use the approved Cognito User Pool federation with GitHub OAuth; the integration layer receives an already-authenticated GitHub access token and does not implement custom sessions.
- Retain S3, DynamoDB, Secrets Manager, and log data during stack deletion by default to reduce accidental data loss.
- Extend the existing DynamoDB resource into a single-table design with `PK/SK` and one `GSI1`; this keeps the MVP inexpensive while supporting the approved user, repository, chunk, investigation, evidence, and issue access patterns.
- Keep repository adapters behind typed interfaces and inject small AWS client ports so business logic and tests do not depend directly on AWS SDK calls.
- Use opaque pagination tokens based on `LastEvaluatedKey`; callers do not depend on DynamoDB key internals.
- Store snapshots and raw repository artifacts under `repositories/{repositoryId}/...` and restrict the Lambda role to that prefix.
- Store ISO-8601 timestamps on every entity and explicit indexing/investigation/entity status fields for resumable workflows.

- Use a framework-neutral fetch router so API behavior is independently testable and does not couple the UI to TanStack route generation.
- Use an in-memory store and no external services for local hackathon operation.
- Return `202 Accepted` from investigation creation because work is asynchronous.
- Keep the worker and engine injectable; production Bedrock calls use the AWS runtime `Converse` API, while tests use a fake model and existing GitHub/storage ports.
- Return one structured error envelope with a request ID for every API failure.
- Use GitHub REST endpoints with native `fetch` rather than adding an SDK; this keeps the MVP small and makes response fixtures deterministic.
- Use the Git Trees API for authoritative file metadata and the Contents API for bounded source extraction; store the GitHub tarball unchanged as the repository snapshot.
- Refuse truncated Git tree responses and never synthesize repository, issue, commit, or PR references.
- Cap retry attempts, pages, extracted files, and file size to keep ingestion bounded for the hackathon.

## Repository retrieval decisions

- Use S3 for serialized chunk content and the existing repository chunk records for metadata and embeddings. This reuses the approved storage boundary.
- Use deterministic hashed-token embeddings for the MVP. They are local, reproducible, testable, and avoid making Bedrock a prerequisite for indexing or local development.
- Use a bounded line-based chunker with configurable `chunkSize` and `overlap`; preserve exact source line ranges and commit provenance on every chunk.
- Use hybrid ranking: 70% cosine similarity and 30% keyword overlap, followed by a configurable similarity threshold and `topK` limit.
- Enforce repository isolation in the storage query and again before scoring results. No cross-repository candidate is eligible for a result.
- Do not introduce OpenSearch, a dedicated vector database, or new infrastructure for this MVP.

## Investigation engine decisions

- Use one orchestrator with explicit phases rather than multi-agent delegation. This makes the call budget, failure behavior, and evidence policy auditable.
- Use Bedrock `Converse` through `@aws-sdk/client-bedrock-runtime`; the selected model ID is configuration, not a source-code secret.
- Treat repository files, issue bodies, commit messages, and documentation as untrusted data. Delimit them in prompts and never allow their text to alter tool policy.
- Make provenance a tool output contract. A factual claim is valid only when all cited evidence IDs resolve to a ledger item from a real repository file, commit, issue, pull request, or documentation source.
- Fail closed on missing evidence, invalid model JSON, tool errors, repository mismatch, timeout, token budget, iteration, retrieved-chunk, or tool-call limits. Return a validated failed result with zero claims.
- Keep Bedrock responsible for planning and language synthesis; keep repository access, evidence resolution, ranking, and validation deterministic in application code.

## Packet 08 lifecycle decisions

- Separate the worker from the agent so lifecycle persistence, retries from platform delivery, status transitions, and safe error handling remain outside intelligence code. The agent only receives a stage callback.
- Reuse the existing DynamoDB investigation partition. Conditional updates implement the smallest reliable idempotency mechanism: only `queued` can be claimed, and only `running` can write progress or terminal state.
- Use an injected asynchronous invoker. Local tests use a deferred callback; deployed Lambda wiring can supply the platform's asynchronous invocation mechanism without introducing a queue or orchestration service.
- Do not add Step Functions, EventBridge, SQS, Redis, Kafka, ECS, Kubernetes, or another scheduler. The existing Lambda/API architecture and bounded agent are sufficient for this packet.
- Do not add automatic retry or a retry state. Duplicate delivery is safely ignored after the conditional claim; explicit retry behavior remains a later decision.
- Derive progress only from actual agent stage callbacks. A stage is never marked complete because elapsed time passed.
- Use the agent's bounded timeout and map timeout summaries to `timeout`; worker failures are persisted with stable codes and a generic public error while detailed causes go only to structured logs.

## Packet 09 integration decisions

- Keep all browser HTTP behavior in `src/api/client.ts` so response validation, timeout behavior, safe errors, and endpoint paths cannot drift across screens.
- Use the existing `/api` router prefix as the deployment-relative base for the frozen resource paths; `VITE_API_BASE_URL` can point to a separate API origin without changing components.
- Poll indexing and investigation status because the existing contracts are asynchronous and the frontend must not invent progress.
- Map backend repository/issue/evidence records into presentation models at the boundary. The visual component structure remains unchanged.
- Treat missing result sections as empty states rather than reconstructing the old mock claims.
- Keep authentication session creation behind `/auth/session`; no token is placed in browser storage or source code.

## Packet 10 golden path decisions

- Validate the golden investigation in process against the real router, resource adapter, service, worker, agent, retrieval and evidence validator, replacing only the external boundaries (GitHub, DynamoDB/S3, Bedrock). Live AWS and Bedrock execution cannot be reproduced in CI, so the harness pins behaviour and `manual-setup.md` documents the deployed verification.
- Derive every golden locator from fixture content. Blob ids use Git's own `sha1("blob <byteLength>\0" + content)` formula, so a reader can recompute them and no path, sha, issue or PR is invented.
- Record the expected answer in a fixture rather than in test prose, so validation is semantic (correct repository, issue, file, commit, PR, root-cause concept) and does not depend on model wording.
- Use a deterministic Bedrock double that cites only evidence ids present in the prompt. This tests retrieval, provenance and validation instead of model phrasing, and it yields like a network call so lifecycle transitions remain observable. The real `Converse` adapter is covered separately by `tests/bedrock.test.ts`.
- Add a composition root instead of new architecture. It wires the approved components into the existing router, accepts an override for every port, and falls back to the minimal router when unconfigured so local development never breaks.
- Down-weight prose in retrieval (markdown x0.75). Measured on the golden dataset, the README and runbook outranked the implicated implementation file because they repeat the symptom wording. Code that implements behaviour is primary evidence for a code investigation; documentation is supporting evidence. `tests/retrieval.test.ts` locks the policy using identical content in two paths.
- Rank Git history by keyword agreement instead of requiring the issue title as an exact substring. Real commit messages rarely repeat an issue title, and the previous rule produced no history evidence at all for the golden issue.
- Include resolved evidence excerpts in the synthesis prompt. The synthesizer previously saw only evidence ids, so it could not describe the evidence it was required to cite.
- Log `toolName`/`phase`, `durationMs` and `success` for every tool and Bedrock call. Token budget, iteration, tool-call and retrieved-chunk limits are unchanged.
- Do not add impact or fix-plan fields. The approved result contract does not contain them, so the UI shows honest empty states and the golden test asserts absence instead of fabricating sections.