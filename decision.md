# Decisions

## AWS foundation decisions

- Use AWS CloudFormation because it is available through the AWS Console and CLI without introducing a new local IaC runtime.
- Use `ap-south-1` as the documented default deployment region; all resources are created in the selected stack region.
- Use generated physical names by default to avoid collisions. An optional S3 bucket name and configurable secret name are exposed as parameters.
- Use an HTTP API as the API Gateway front door. The application stack adds the Lambda integration in a later deployment; no application behavior is duplicated in infrastructure.
- Define the execution role in the foundation stack and attach the Lambda function to that pre-scoped role in the application stack.
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
## Packet 11 hardening decisions

- Keep tests in process and mock only the external boundaries (GitHub, DynamoDB/S3, Bedrock). CI has no AWS, network or credentials, so live calls would make the suite flaky and expensive; `manual-setup.md` documents the deployed verification.
- Treat model output as untrusted. Prompt-injection containment is proven structurally: repository text is always wrapped in `<repository-data>` under a system prompt that declares it untrusted data, and the orchestrator (not the model) chooses tool calls. `tests/prompt-injection.test.ts` asserts the framing, the approved-tool allowlist, rejection of injection-driven fabrication and log hygiene.
- Add a bounded async dispatch retry (default 3 attempts, max 5) instead of new infrastructure. Re-delivery is safe because claiming is conditional on `queued`, so retries cannot create duplicate investigations.
- Validate "no fabricated evidence" end to end: claims must cite ids the tools returned, `buildEvidence` resolves them against the ledger, and unresolved or duplicated ids fail the investigation instead of being persisted.
- Ship a deterministic in-repo secret and IaC scan (`tests/security.test.ts`) because the gitleaks and trivy binaries are not installed locally. Both scanners stay in CI (`.github/workflows/validation.yml`), and `npm audit --omit=dev` reports 0 production vulnerabilities.
- Use the existing API-client plus view-model boundary for the frontend flow test. No browser automation framework is installed, so rather than adding a heavy dependency the test drives the real `apiClient` over a fetch shim into the real router and asserts the view models end to end.

## Packet 12 deployment decisions

- Deploy with two CloudFormation stacks (foundation, then application) rather than one. The split keeps the retained data resources out of reach of routine application redeploys and lets the Lambda package be uploaded before the function is created, which removes the "code does not exist yet" ordering problem.
- Keep the default Vite/Nitro preset untouched and add `vite.config.aws.ts`. The repository must still build with the existing configuration for every other target; the AWS build is additive.
- Package the Lambda from a single esbuild bundle plus the Nitro server output instead of introducing a container image or a bundler plugin. It keeps the deployment dependency-free and the artifact small.
- Self-invoke the Lambda for asynchronous work with `InvocationType: "Event"` and a magic `marker`, instead of adding SQS or Step Functions. This preserves the existing worker architecture, needs only the scoped `lambda:InvokeFunction` permission, and keeps local development running in-process when the function name is unset.
- Await `enqueue`/`startIndex` before returning. Lambda freezes the execution environment after the handler resolves, so a fire-and-forget dispatch could be dropped; awaiting guarantees the invocation is sent while the same `claimQueued` guard still prevents duplicates.
- Serve the frontend from CloudFront with an Origin Access Control and route the default behavior to the API origin. One origin handles SSR and `/api`, so the browser keeps using the relative `/api` base and no wildcard CORS is needed.
- Inject the GitHub token through the Secrets Manager dynamic reference `{{resolve:secretsmanager:...}}` at deploy time. No token is committed, and the secret is never written into the build.
- Set the Lambda timeout (300 s) well above the bounded agent timeout (30 s) rather than tuning it close to the expected run, so cold starts and ingestion cannot trip the limit.
- Keep the runtime Bedrock model id and the IAM foundation-model ARN separate. The ARN stays a deployment parameter scoped to `bedrock:InvokeModel`; the model id is never hardcoded into the ARN.
- Add a monthly cost budget and rely on request-driven Lambda plus on-demand DynamoDB instead of any always-on infrastructure.
- Provide `deploy`/`rollback` in both PowerShell and bash. The scripts read stack outputs, so the deployment order and resource names are not manual steps and a redeploy is repeatable.
- Do not enforce Cognito authentication in the API itself for the hackathon demo; the existing GitHub session boundary is the active login, and Cognito is provisioned as the approved authentication configuration for a later step. Changing enforcement would alter the existing API architecture.