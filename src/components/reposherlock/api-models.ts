import {
  evidenceSchema,
  type ApiEvidence,
  type ApiInvestigation,
  type ApiIssue,
  type ApiRepository,
} from "@/api/client";

export type RepositoryView = {
  repositoryId: string;
  name: string;
  owner: string;
  language: string;
  defaultBranch?: string;
  stars: string;
  issues: string;
  updated: string;
  size: string;
  color: "blue" | "mint" | "peach" | "lavender";
};

export type IssueView = {
  number: number;
  title: string;
  labels: string[];
  author: string;
  age: string;
  comments: number;
  status: string;
};

export type EvidenceView = {
  id: string;
  kind: string;
  name: string;
  locator: string;
  excerpt: string;
  time: string;
  relation: string;
  accent: "blue" | "violet" | "coral";
};

const colors: RepositoryView["color"][] = ["blue", "mint", "peach", "lavender"];

export function toRepositoryView(repository: ApiRepository, index = 0): RepositoryView {
  const owner = typeof repository.owner === "string" ? repository.owner : repository.owner.login;
  return {
    repositoryId: repository.repositoryId ?? String(repository.id ?? `${owner}/${repository.name}`),
    name: repository.name,
    owner,
    language: repository.language ?? "Unknown",
    ...(repository.defaultBranch === undefined ? {} : { defaultBranch: repository.defaultBranch }),
    stars: "",
    issues: "",
    updated: repository.updatedAt ?? "",
    size: "",
    color: colors[index % colors.length]!,
  };
}

export function toIssueView(issue: ApiIssue): IssueView {
  return {
    number: issue.issueNumber ?? issue.number ?? 0,
    title: issue.title,
    labels: (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)),
    author: issue.user?.login ?? "unknown",
    age: issue.updatedAt ?? "",
    comments: issue.comments ?? 0,
    status: issue.state,
  };
}

export function toEvidenceView(evidence: ApiEvidence): EvidenceView {
  const provenance = evidence.provenance;
  const isFile = provenance.type === "repository_file" || provenance.type === "documentation";
  const locator = isFile
    ? `${String(provenance["filePath"] ?? "source")} · Lines ${String(provenance["startLine"] ?? "?")}-${String(provenance["endLine"] ?? "?")}`
    : provenance.type === "commit"
      ? String(provenance["commitSha"] ?? "commit")
      : `#${String(provenance["issueNumber"] ?? "issue")}`;
  return {
    id: evidence.evidenceId,
    kind: provenance.type.replace(/_/g, " ").toUpperCase(),
    name: isFile ? String(provenance["filePath"] ?? "Source file") : locator,
    locator,
    excerpt: evidence.excerpt,
    time: "Verified by RepoSherlock",
    relation: "Resolved from repository provenance",
    accent:
      provenance.type === "commit"
        ? "violet"
        : provenance.type === "issue" || provenance.type === "pull_request"
          ? "coral"
          : "blue",
  };
}

export function resultEvidence(result?: ApiInvestigation): EvidenceView[] {
  const values = result?.evidence ?? (result?.result?.["evidence"] as unknown[] | undefined) ?? [];
  return values.flatMap((value) => {
    const parsed = evidenceSchema.safeParse(value);
    return parsed.success ? [toEvidenceView(parsed.data)] : [];
  });
}

export function resultSummary(result?: ApiInvestigation): string {
  return typeof result?.result?.["summary"] === "string" ? String(result.result["summary"]) : "";
}
