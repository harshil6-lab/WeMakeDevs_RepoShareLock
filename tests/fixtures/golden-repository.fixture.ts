import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Golden dataset for the end-to-end investigation.
 *
 * The repository below is a real, inspectable fixture tree under
 * `tests/fixtures/golden-repository/`. File contents are read from disk and the
 * Git object ids are derived from that content, so no path, blob, tree or commit
 * id in this dataset is invented: every locator can be recomputed by a reader.
 */

const fixtureRoot = new URL("./golden-repository/", import.meta.url);

export function readGoldenFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, fixtureRoot), "utf8");
}

/** Mirrors Git's blob object id: sha1("blob <byteLength>\0" + content). */
function blobObjectId(content: string): string {
  const header = `blob ${Buffer.byteLength(content, "utf8")}\0`;
  return createHash("sha1").update(header).update(content, "utf8").digest("hex");
}

/** Deterministic fixture identity for a commit, derived from its metadata. */
function commitObjectId(commit: { message: string; author: { name: string; date: string } }) {
  return createHash("sha1")
    .update(`${commit.message}\n${commit.author.name}\n${commit.author.date}\n`)
    .digest("hex");
}

export type GoldenFile = {
  path: string;
  language: string;
  content: string;
  blobSha: string;
  size: number;
};

const goldenFileDefinitions: Array<{ path: string; language: string }> = [
  { path: "README.md", language: "Markdown" },
  { path: "docs/runbooks/payments-webhooks.md", language: "Markdown" },
  { path: "src/payments/ledger.ts", language: "TypeScript" },
  { path: "src/payments/provider.ts", language: "TypeScript" },
  { path: "src/webhooks/payment.ts", language: "TypeScript" },
];

export const goldenFiles: GoldenFile[] = goldenFileDefinitions.map((definition) => {
  const content = readGoldenFile(definition.path);
  return {
    ...definition,
    content,
    blobSha: blobObjectId(content),
    size: Buffer.byteLength(content, "utf8"),
  };
});

export const goldenFileByPath = new Map(goldenFiles.map((file) => [file.path, file]));

/** Tree object id derived from the sorted blob entries it contains. */
const treeObjectId = createHash("sha1")
  .update(
    [...goldenFiles]
      .sort((left, right) => (left.path < right.path ? -1 : 1))
      .map((file) => `100644 blob ${file.blobSha}\t${file.path}\n`)
      .join(""),
  )
  .digest("hex");

type GoldenCommitSeed = { message: string; author: { name: string; date: string } };

// Newest first, matching the GitHub list-commits ordering used by the engine.
const goldenCommitSeeds: GoldenCommitSeed[] = [
  {
    message: "Move payment provider call before webhook acknowledgement",
    author: { name: "maya.chen", date: "2026-01-18T11:05:00Z" },
  },
  {
    message: "Add retry to the payment provider client",
    author: { name: "dev.anand", date: "2025-12-02T08:41:00Z" },
  },
  {
    message: "Initial payment webhook handler",
    author: { name: "maya.chen", date: "2025-11-04T16:20:00Z" },
  },
];

export const goldenCommits = goldenCommitSeeds.map((seed) => ({
  sha: commitObjectId(seed),
  message: seed.message,
  author: seed.author,
}));

export const goldenRepositoryFixture = {
  id: 1294,
  repositoryId: "1294",
  owner: "acme",
  name: "payments-service",
  fullName: "acme/payments-service",
  defaultBranch: "main",
  private: false,
  updatedAt: "2026-02-11T09:24:00Z",
  treeSha: treeObjectId,
};

export type GoldenIssueDetail = {
  number: number;
  title: string;
  state: "open" | "closed";
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  comments: number;
  body: string;
  isPullRequest: boolean;
};

export const goldenIssueDetail: GoldenIssueDetail = {
  number: 1842,
  title: "Payment webhook intermittently times out",
  state: "open",
  author: "maya.chen",
  createdAt: "2026-02-05T07:12:00Z",
  updatedAt: "2026-02-09T18:44:00Z",
  labels: ["bug", "payments", "priority-high"],
  comments: 18,
  body: [
    "Provider webhook deliveries intermittently return 504 at the edge.",
    "Failures spike when the provider is slow, and the same event is",
    "re-delivered several times before we acknowledge it.",
    "",
    "Reproduction: hold the provider charge endpoint at 12s and deliver a",
    "webhook event. The delivery is retried even though the first request",
    "eventually succeeds.",
  ].join("\n"),
  isPullRequest: false,
};

export const goldenRelatedPullRequest: GoldenIssueDetail = {
  number: 1742,
  title: "Webhook timeout reported under high provider latency",
  state: "closed",
  author: "dev.anand",
  createdAt: "2025-09-02T10:00:00Z",
  updatedAt: "2025-09-14T12:30:00Z",
  labels: ["bug", "payments"],
  comments: 6,
  body: "Same symptom under provider load. Closed as a duplicate of #1842.",
  isPullRequest: true,
};

/** Distractor issue that shares no meaningful tokens with issue #1842. */
export const goldenUnrelatedIssue: GoldenIssueDetail = {
  number: 1837,
  title: "User session expires unexpectedly",
  state: "open",
  author: "sam.lee",
  createdAt: "2026-01-29T09:00:00Z",
  updatedAt: "2026-02-01T09:00:00Z",
  labels: ["bug", "auth"],
  comments: 3,
  body: "Sessions are dropped before the configured lifetime.",
  isPullRequest: false,
};

function toGitHubIssue(issue: GoldenIssueDetail) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    user: { login: issue.author },
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    html_url: `https://github.com/${goldenRepositoryFixture.fullName}/issues/${issue.number}`,
    ...(issue.isPullRequest
      ? {
          pull_request: {
            url: `https://api.github.com/repos/${goldenRepositoryFixture.fullName}/pulls/${issue.number}`,
          },
        }
      : {}),
  };
}

export const goldenRepositoryIssues = [
  goldenIssueDetail,
  goldenRelatedPullRequest,
  goldenUnrelatedIssue,
].map(toGitHubIssue);

export const goldenRelatedSearchResults = [goldenRelatedPullRequest, goldenUnrelatedIssue].map(
  toGitHubIssue,
);

export function goldenCommitBySha(sha: string) {
  return goldenCommits.find((commit) => commit.sha === sha);
}

/** Every object id that legitimately exists in the golden repository. */
export const goldenObjectIds = new Set<string>([
  goldenRepositoryFixture.treeSha,
  ...goldenFiles.map((file) => file.blobSha),
  ...goldenCommits.map((commit) => commit.sha),
]);

/**
 * The recorded expected answer for issue #1842.
 *
 * This is the golden fixture the investigation is validated against. It is
 * derived from the fixture repository above, not from any model output.
 */
export const goldenExpectations = {
  repositoryId: goldenRepositoryFixture.repositoryId,
  owner: goldenRepositoryFixture.owner,
  name: goldenRepositoryFixture.name,
  issueNumber: goldenIssueDetail.number,
  issueTitle: goldenIssueDetail.title,
  relevantFile: "src/webhooks/payment.ts",
  relevantFunction: "handlePaymentWebhook",
  relevantCommitSha: goldenCommits[0]!.sha,
  relevantCommitMessage: goldenCommits[0]!.message,
  relatedPullRequest: goldenRelatedPullRequest.number,
  rootCauseConcept: {
    description:
      "The webhook awaits a synchronous downstream payment provider call before it acknowledges the delivery, so provider latency and timeouts surface as intermittent webhook timeouts.",
    keywords: ["provider", "acknowledge", "timeout", "webhook", "await", "before"],
  },
  expectedEvidenceSources: [
    { type: "repository_file", filePath: "src/webhooks/payment.ts" },
    { type: "commit", commitSha: goldenCommits[0]!.sha },
    { type: "pull_request", issueNumber: goldenRelatedPullRequest.number },
  ],
  relevantCodeSignals: ["handlePaymentWebhook", "chargeWithProvider", "acknowledgeWebhook"],
} as const;

export type GoldenExpectations = typeof goldenExpectations;
