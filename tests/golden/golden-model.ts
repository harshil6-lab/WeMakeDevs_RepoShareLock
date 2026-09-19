import type { BedrockModel } from "../../src/investigation/bedrock";
import { goldenExpectations } from "../fixtures/golden-repository.fixture";

export type RecordedBedrockCall = {
  phase: string;
  maxTokens: number;
  prompt: string;
};

export type RecordingBedrockModel = BedrockModel & {
  readonly calls: RecordedBedrockCall[];
  phaseCount: (phase: string) => number;
};

type LedgerEvidence = {
  evidenceId: string;
  excerpt: string;
  provenance: { type: string; filePath?: string; commitSha?: string; issueNumber?: number };
};

/**
 * Deterministic stand-in for Amazon Bedrock.
 *
 * It never invents evidence: every id it cites is read out of the prompt the
 * engine sent, which itself only contains ids resolved by repository tools. Its
 * prose is produced from the retrieved evidence, so the golden assertions test
 * retrieval, provenance and validation rather than model wording.
 */
export function createRecordingBedrockModel(): RecordingBedrockModel {
  const calls: RecordedBedrockCall[] = [];

  const phaseOf = (prompt: string) => prompt.match(/\[PHASE:([A-Z]+)\]/)?.[1] ?? "UNKNOWN";

  const repositoryData = (prompt: string): unknown => {
    const match = prompt.match(/<repository-data>\n([\s\S]*)\n<\/repository-data>/);
    if (!match) throw new Error("Golden model received a prompt without repository data");
    return JSON.parse(match[1]!);
  };

  const claimsFor = (prompt: string) => {
    const data = repositoryData(prompt) as {
      availableEvidence?: string[];
      evidence?: LedgerEvidence[];
    };
    const available = data.availableEvidence ?? [];
    const evidence = data.evidence ?? [];
    const fileIds = available.filter((id) => id.startsWith("file:"));
    const commitIds = available.filter((id) => id.startsWith("commit:"));
    const relatedIds = [
      ...available.filter((id) => id.startsWith("pull_request:")),
      ...available.filter((id) => id.startsWith("issue:")),
    ];

    // Ground the prose in the retrieved evidence for the implicated file.
    const fileEvidence = evidence.find(
      (item) =>
        item.provenance.type === "repository_file" &&
        typeof item.provenance.filePath === "string" &&
        /handlePaymentWebhook|acknowledgeWebhook/.test(item.excerpt),
    );
    const filePath = fileEvidence?.provenance.filePath ?? goldenExpectations.relevantFile;

    const claims: Array<{ text: string; evidenceIds: string[] }> = [];
    const rootCauseIds = [fileIds[0], commitIds[0]].filter((id): id is string => Boolean(id));
    if (rootCauseIds.length > 0) {
      claims.push({
        text: `${filePath} awaits the downstream payment provider call before it acknowledges the webhook, so provider latency surfaces as intermittent webhook timeouts.`,
        evidenceIds: rootCauseIds,
      });
    }
    if (relatedIds[0]) {
      claims.push({
        text: `The same webhook timeout symptom was reported earlier under high provider latency.`,
        evidenceIds: [relatedIds[0]],
      });
    }
    if (claims.length === 0) throw new Error("Golden model found no resolved evidence to cite");
    return { claims };
  };

  return {
    calls,
    phaseCount: (phase) => calls.filter((call) => call.phase === phase).length,
    converse: async (_systemPrompt, userPrompt, maxTokens) => {
      const phase = phaseOf(userPrompt);
      calls.push({ phase, maxTokens, prompt: userPrompt });
      // A real Bedrock call is a network round trip. Yielding here keeps the
      // in-process pipeline faithful to that timing so lifecycle transitions
      // are observable instead of collapsing into a single microtask.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (phase === "HYPOTHESIZE" || phase === "SYNTHESIZE")
        return JSON.stringify(claimsFor(userPrompt));
      return `Plan acknowledged for phase ${phase}.`;
    },
  };
}
