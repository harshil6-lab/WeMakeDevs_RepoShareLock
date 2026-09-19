RepoSherlock — Knowledge.md
Project
RepoSherlock is an AI-powered agentic software-engineering investigation platform for investigating real GitHub issues using repository code, Git history, issues/PRs, and RAG-backed evidence.
MVP constraint: The system must remain simple enough to implement and demo during a 3-day hackathon.
Core lifecycle:
`CONNECT → INGEST → INDEX → INVESTIGATE → RETRIEVE → REASON → VERIFY → STORE → DISPLAY EVIDENCE`
Core principle:
> The agent must retrieve real repository/GitHub evidence before generating the final investigation. Model output is not trusted as a source of repository facts.
---
Architecture
Main flow
```text
Developer
  ↓
React Frontend
  ↓
CloudFront / S3
  ↓
API Gateway
  ↓
API Lambda
```
Authentication
```text
React Frontend
  ↓
Amazon Cognito
  ↓
GitHub OAuth
```
Use managed authentication. Do not build custom authentication/session infrastructure for the MVP.
Repository ingestion
```text
API Lambda
  ↓
GitHub API
  ↓
Repository Ingestion Lambda
  ↓
S3
  ↓
Embedding / Indexing Lambda
  ↓
DynamoDB
```
Important: API Lambda, Repository Ingestion Lambda, and Embedding/Indexing Lambda are separate components.
Responsibilities:
API Lambda: API request handling, validation, application orchestration.
Repository Ingestion Lambda: fetch repository, extract files, build structure information, chunk source.
Embedding/Indexing Lambda: generate embeddings and persist embedding/chunk metadata.
Investigation
```text
Frontend
  ↓
API Gateway
  ↓
Investigation Lambda
  ↓
Agent Orchestrator
  ↓
Single Agent
  ↓
Agent Tools + RAG
  ↓
Amazon Bedrock Claude
  ↓
Structured Investigation JSON
  ↓
Evidence Validator
  ↓
DynamoDB
  ↓
Frontend
```
There is one agent, not multiple agents.
---
AWS Services
Area	Service
Frontend	Amazon S3 + CloudFront
Authentication	Amazon Cognito + GitHub OAuth
API	API Gateway REST
API compute	AWS Lambda
Repository ingestion	AWS Lambda
Embedding/indexing	AWS Lambda
Repository artifacts	Amazon S3
Application metadata	DynamoDB
MVP vector retrieval	DynamoDB + Lambda in-memory/brute-force cosine similarity
AI reasoning	Amazon Bedrock Claude
Observability	Amazon CloudWatch
Explicitly excluded from MVP
Do not introduce:
OpenSearch
Step Functions
EventBridge
ECS
Kubernetes
PostgreSQL
Dedicated vector DB
Multiple AI agents
Autonomous code generation
Automatic PR creation
Enterprise security infrastructure
Reason: unnecessary operational complexity for a 3-day hackathon and demo-scale repositories.
---
Functional Requirements
FR1 — OAuth login and repository selection
Developer authenticates and selects a GitHub repository accessible to them.
FR2 — Repository ingestion
Repository ingestion must:
fetch/clone repository data
build a structure map
extract source files
chunk source
generate embeddings
index commit metadata
FR3 — Issue listing and selection
List real GitHub issues from the connected repository and allow the developer to select one.
FR4 — Investigation trigger
Selected issue + INVESTIGATE starts an orchestrated, bounded investigation.
FR5 — Structured output
Final investigation must match a fixed JSON schema. Do not use arbitrary free-form final output.
FR6 — Evidence-backed claims
Every hypothesis/claim must have at least one evidence item with:
source type
source locator
FR7 — Evidence drill-down
UI provides a `WHY?` action that retrieves exact evidence details.
FR8 — Related issues/PRs
Related issues and PRs must come from real GitHub search/API results. Never hallucinate them.
FR9 — Fix plan
Fix/implementation plan must be ordered steps, not a prose paragraph.
FR10 — Personal/team knowledge
Should-have: README, runbooks, postmortems, and similar documents may contribute investigation context, with provenance.
FR11 — Basic blast radius
Should-have: identify files/modules that import or call implicated code.
---
Non-Functional Requirements
Bounded investigation
Target:
`<60 seconds` for a small-to-medium demo repository.
Frontend must show visible progress.
Bounded agent execution
Hard cap on tool calls/iterations. No infinite loops.
No fabricated references
Never show fabricated:
file paths
commit SHAs
issue numbers
PR numbers
References must resolve against real indexed repository or GitHub data.
Isolation
Repository code/data must be isolated per user/session.
Secret handling
Never log secrets.
Never put raw secrets into prompts.
Apply redaction rules.
Never expose GitHub tokens to model context.
Graceful degradation
GitHub rate limits and Bedrock timeouts must produce controlled failure/partial states instead of crashing the demo.
Cost
Keep per-investigation cost low enough for dozens of live demonstrations.
---
Investigation Agent
Tools
The single agent has these tools:
```text
search_repository
read_file
search_git_history
get_commit
search_related_issues
build_evidence
generate_investigation
```
Tool responsibilities
search_repository
Search indexed repository chunks.
Return relevant chunks and real file paths.
read_file
Read a specific real repository file.
Never invent a path.
search_git_history
Search relevant commits/history.
get_commit
Resolve and retrieve a real commit by SHA.
search_related_issues
Search real GitHub issues and pull requests.
build_evidence
Build evidence records linking claims to real sources/locators.
generate_investigation
Generate the final investigation using the fixed structured schema.
---
Agent Loop
```text
PLAN
  ↓
SEARCH
  ↓
RETRIEVE
  ↓
ANALYZE
  ↓
HYPOTHESIZE
  ↓
VERIFY
  ↓
SYNTHESIZE
```
The loop is bounded by a hard iteration/tool-call cap.
Stop when:
sufficient evidence has been collected, OR
the hard limit is reached.
Never bypass Evidence Validator.
---
RAG
Do not use OpenSearch.
MVP retrieval:
```text
Repository source
  ↓
Chunking
  ↓
Embeddings
  ↓
Embedding records
  ↓
Query embedding
  ↓
In-memory cosine similarity
  ↓
Top-K chunks
  ↓
Agent context
```
Use DynamoDB for embedding/chunk metadata and Lambda for demo-scale brute-force similarity.
Target scale: hundreds to low-thousands of chunks.
Do not introduce a dedicated vector database.
---
Storage
S3
Store large repository artifacts:
```text
Repository Snapshots
Raw Files
Processing Artifacts
```
Examples:
repository snapshot
raw source files
extracted/chunked artifacts
processing artifacts
DynamoDB
Primary application metadata database.
Logical entities:
```text
User
Repository
RepositoryFile
RepositoryChunk
Investigation
Evidence
Issue
Commit
PullRequest
```
---
Data Model
User
```text
user_id
github_id
display_name
created_at
```
Relationship:
`User → Repository (1:N)`
Repository
```text
repository_id
user_id
github_owner
github_name
default_branch
status
indexed_at
```
Relationships:
```text
Repository → RepositoryFile (1:N)
Repository → Issue (1:N)
Repository → Commit (1:N)
Repository → PullRequest (1:N)
Repository → Investigation (1:N)
```
RepositoryFile
```text
repository_id
file_path
language
size
commit_sha
```
Relationship:
`RepositoryFile → RepositoryChunk (1:N)`
RepositoryChunk
```text
repository_id
chunk_id
file_path
content
embedding
commit_sha
start_line
end_line
created_at
```
Investigation
```text
investigation_id
repository_id
issue_number
status
hypothesis
confidence
created_at
completed_at
```
Relationship:
`Investigation → Evidence (1:N)`
Evidence
```text
investigation_id
evidence_id
source_type
source_locator
file_path
commit_sha
issue_number
excerpt
relationship
created_at
```
Evidence may reference:
```text
RepositoryFile
Commit
Issue
PullRequest
```
Issue
```text
repository_id
issue_number
title
state
author
created_at
```
Commit
```text
repository_id
commit_sha
author
message
created_at
```
PullRequest
```text
repository_id
pr_number
title
state
author
created_at
```
---
API Contract
Authentication
POST /auth/session
Purpose: establish/resolve application session after GitHub authentication.
Example response:
```json
{
  "user_id": "usr_123",
  "github_id": "123456",
  "display_name": "Developer"
}
```
Do not store raw GitHub access tokens in DynamoDB.
---
Repositories
GET /repositories
List accessible/connected repositories.
POST /repositories
Connect a GitHub repository.
Request:
```json
{
  "github_owner": "owner",
  "github_name": "repo"
}
```
GET /repositories/{repository_id}
Return repository metadata and current indexing state.
POST /repositories/{repository_id}/index
Start asynchronous repository indexing.
Example:
```json
{
  "repository_id": "repo_123",
  "status": "indexing"
}
```
GET /repositories/{repository_id}/index-status
Return indexing state/progress.
Possible states:
```text
not_started
indexing
indexed
failed
```
Example:
```json
{
  "repository_id": "repo_123",
  "status": "indexing",
  "progress": 65
}
```
---
Issues
GET /repositories/{repository_id}/issues
List real GitHub issues.
GET /repositories/{repository_id}/issues/{issue_number}
Retrieve one real GitHub issue.
Issue information comes from GitHub API data.
---
Investigations
POST /investigations
Start an asynchronous investigation.
Request:
```json
{
  "repository_id": "repo_123",
  "issue_number": 42
}
```
Response:
```json
{
  "investigation_id": "inv_123",
  "status": "queued"
}
```
GET /investigations/{investigation_id}
Retrieve structured investigation JSON.
GET /investigations/{investigation_id}/status
Used for frontend polling and visible progress.
Possible states:
```text
queued
running
completed
failed
```
Example:
```json
{
  "investigation_id": "inv_123",
  "status": "running",
  "progress": 65,
  "current_step": "VERIFY"
}
```
GET /investigations/{investigation_id}/evidence
Retrieve evidence for WHY? drill-down.
---
Investigation Output
Frontend renders:
```text
Root Cause
Confidence
Evidence
Relevant Files
History
Impact
Fix Plan
```
The final investigation is structured JSON, not free-form text.
Fix plan is an ordered list of steps.
Evidence contains exact source/locator information.
---
Evidence Integrity
This is a core system invariant:
```text
Claim
  ↓
Evidence Validator
  ↓
Evidence exists?
  ├─ NO → Reject claim
  └─ YES
       ↓
Validate source + locator
       ↓
Validated claim
       ↓
DynamoDB
```
Unsupported claims cannot enter the final persisted investigation.
The agent/model cannot create fake file paths, commits, issues, PRs, or locators.
---
Sequence: Investigating a GitHub Issue
```text
Developer
  ↓
React Frontend
  ↓ POST /investigations
API Gateway
  ↓
API Lambda
  ↓
Investigation Lambda
  ↓
Agent Orchestrator
```
Then the bounded agent loop:
```text
PLAN
 ↓
SEARCH
 ↓
RETRIEVE
 ↓
ANALYZE
 ↓
HYPOTHESIZE
 ↓
VERIFY
 ↓
SYNTHESIZE
```
Evidence sources:
```text
Repository Search Tool
Git History Tool
Related Issue Tool
RAG Retrieval
```
Reasoning:
```text
Real evidence
  ↓
Grounded context
  ↓
Amazon Bedrock Claude
  ↓
Structured hypothesis/investigation
  ↓
Evidence Validator
  ↓
DynamoDB
```
Frontend then uses:
```text
GET /investigations/{id}/status
GET /investigations/{id}
GET /investigations/{id}/evidence
```
---
WHY? Drill-down
When a developer clicks WHY?:
```text
Developer
  ↓
React Frontend
  ↓
GET /investigations/{id}/evidence
  ↓
API Gateway
  ↓
API Lambda
  ↓
DynamoDB
  ↓
Exact evidence source + locator
  ↓
React Frontend
```
The UI displays the exact evidence behind the claim.
---
Error Handling
GitHub API rate limit
Return controlled rate-limit/partial state.
Preserve already collected evidence where possible.
Bedrock timeout
Return controlled failure/partial state and allow retry.
Invalid evidence
Reject unsupported claim. Do not persist it as a validated final claim.
Agent limit reached
Stop immediately at hard cap and mark investigation incomplete/partial.
---
Observability
Use Amazon CloudWatch for:
```text
API Lambda
Repository Ingestion Lambda
Embedding/Indexing Lambda
Investigation Lambda
Agent Orchestrator
Amazon Bedrock
```
Monitor:
errors
latency
investigation duration
tool-call count
timeouts
GitHub API failures
embedding failures
Bedrock failures
Do not introduce another observability service.
---
Implementation Rules for Agents
When implementing RepoSherlock:
Read this file before changing architecture.
Preserve the MVP boundaries unless a requirement explicitly requires change.
Prefer existing Lambda components over creating new services.
Prefer DynamoDB for application metadata.
Prefer S3 for repository artifacts.
Do not introduce OpenSearch/PostgreSQL/vector DB for MVP.
Keep one investigation agent.
Keep the agent loop bounded.
Ground model reasoning in retrieved evidence.
Validate evidence before persistence.
Never fabricate repository references.
Never log secrets or put raw secrets in model prompts.
Keep repository data isolated by user/repository.
Keep investigations asynchronous and expose progress.
Handle GitHub/Bedrock failures gracefully.
Keep implementation simple enough for a 3-day hackathon.
Do not add infrastructure merely because it would be common in a large production system.
---
Architecture Invariants
These must remain true:
```text
Single Agent
+
Bounded Tool Calls
+
Real Repository/GitHub Retrieval
+
Grounded Bedrock Reasoning
+
Evidence Validation
+
Validated Persistence
```
The most important invariant:
> **No unsupported claim can enter the final investigation.**