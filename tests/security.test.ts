import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  ".output",
  ".output-aws",
  "dist-lambda",
  ".wrangler",
  ".tanstack",
  ".lovable",
  "dist",
  "coverage",
]);
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".txt",
  ".tf",
  ".cfg",
  ".ini",
  ".sh",
  ".ps1",
]);

function collectFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...collectFiles(path));
    else files.push(path);
  }
  return files;
}

const files = collectFiles(workspace);

/** Patterns that indicate a real credential was committed. */
const credentialPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "AWS access key id", pattern: /AKIA[0-9A-Z]{16}/ },
  { label: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "GitHub classic token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { label: "GitHub fine-grained token", pattern: /github_pat_[A-Za-z0-9_]{22,}/ },
  { label: "Slack token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
];

describe("repository secret hygiene", () => {
  it("commits no credential files", () => {
    const forbidden = files.filter(
      (file) => /(^|[\\/])\.env$/.test(file) || /\.(pem|key|p12|pfx)$/i.test(file),
    );
    expect(forbidden).toEqual([]);
  });

  it("contains no recognized credential patterns", () => {
    const findings: string[] = [];
    for (const file of files) {
      if (!textExtensions.has(extname(file))) continue;
      const content = readFileSync(file, "utf8");
      for (const { label, pattern } of credentialPatterns)
        if (pattern.test(content)) findings.push(label + " in " + file);
    }
    expect(findings).toEqual([]);
  });
});

describe("infrastructure least privilege", () => {
  const template = readFileSync(
    join(workspace, "infrastructure", "cloudformation", "template.yaml"),
    "utf8",
  );

  it("blocks public access on the artifacts bucket", () => {
    expect(template).toMatch(/BlockPublicAcls:\s*true/);
    expect(template).toMatch(/IgnorePublicAcls:\s*true/);
    expect(template).toMatch(/BlockPublicPolicy:\s*true/);
    expect(template).toMatch(/RestrictPublicBuckets:\s*true/);
    expect(template).toMatch(/SSEAlgorithm:\s*AES256/);
  });

  it("never grants wildcard IAM actions and scopes Bedrock to the model ARN parameter", () => {
    expect(template).not.toMatch(/Action:\s*"\*"/);
    expect(template).not.toMatch(/-\s*"\*"\s*$/m);
    expect(template).not.toMatch(/(s3|dynamodb|bedrock):\*/);
    expect(template).toMatch(/Action:\s*bedrock:InvokeModel\b/);
    expect(template).toMatch(/Resource:\s*!Ref BedrockModelArns/);
    // The one approved model ARN is allowed as the parameter default; the IAM
    // resource itself must stay a parameter reference, never a literal ARN.
    expect(template).toMatch(
      /Default:\s*"arn:aws:bedrock:ap-south-1::foundation-model\/nvidia\.nemotron-nano-12b-v2"/,
    );
    expect(template).not.toMatch(/foundation-model\/(?!nvidia\.nemotron-nano-12b-v2)[a-z0-9.-]+/i);
    expect(template).not.toMatch(/Resource:\s*arn:aws:bedrock/i);
  });
});

describe("cross-account Bedrock role assumption", () => {
  const foundation = readFileSync(
    join(workspace, "infrastructure", "cloudformation", "template.yaml"),
    "utf8",
  );
  const app = readFileSync(join(workspace, "infrastructure", "cloudformation", "app.yaml"), "utf8");

  it("scopes sts:AssumeRole to the exact Bedrock role, never a wildcard", () => {
    expect(foundation).toMatch(/Sid:\s*BedrockRoleAssumption/);
    expect(foundation).toMatch(/Action:\s*sts:AssumeRole\b/);
    expect(foundation).toMatch(/Resource:\s*!Ref BedrockRoleArn/);
    expect(foundation).not.toMatch(/Action:\s*sts:\*/);
    expect(foundation).toMatch(
      /Default:\s*"arn:aws:iam::343218215737:role\/RepoSherlockBedrockRole"/,
    );
  });

  it("passes the exact cross-account role ARN into the Lambda environment", () => {
    expect(app).toMatch(/REPOSHERLOCK_BEDROCK_ROLE_ARN:\s*!Ref BedrockRoleArn/);
    expect(app).toMatch(/Default:\s*arn:aws:iam::343218215737:role\/RepoSherlockBedrockRole/);
  });
});

describe("API surface hardening", () => {
  const server = readFileSync(join(workspace, "src", "server.ts"), "utf8");
  const workflow = readFileSync(join(workspace, ".github", "workflows", "validation.yml"), "utf8");

  it("does not serve a wildcard CORS header", () => {
    expect(server).not.toMatch(/Access-Control-Allow-Origin/i);
  });

  it("keeps secret scanning and dependency audit enabled in CI", () => {
    expect(workflow).toMatch(/gitleaks/i);
    expect(workflow).toMatch(/npm audit/i);
    expect(workflow).toMatch(/npm run lint/i);
    expect(workflow).toMatch(/tsc --noEmit/);
  });
});
