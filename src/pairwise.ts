import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicToken } from "./token";
import { readFile, writeFile, readdir, stat } from "fs/promises";
import { join } from "path";

interface PairwiseResult {
  promptId: string;
  variantA: string;
  variantB: string;
  winnerAB: "A" | "B" | "tie";
  winnerBA: "A" | "B" | "tie";
  consistent: boolean;
  finalWinner: string;
  reasoningAB: string;
  reasoningBA: string;
}

const PAIRWISE_PROMPT = `You are comparing two responses to the same task. You must pick a winner.

## Task
{task}

## Response A
{responseA}

## Response B
{responseB}

Which response is better at the task? Consider:
- Does it follow investigation-before-fix discipline?
- Is the root cause analysis more precise?
- Are the proposed investigation steps more actionable?
- Is it more concise without losing substance?

You MUST pick a winner. "Tie" only if they are genuinely indistinguishable.

Respond with ONLY valid JSON:
{"winner": "A" or "B" or "tie", "reasoning": "<2 sentences max>"}`;

export async function pairwiseCompare(
  scenario: string,
  variantA: string,
  variantB: string,
  outputA: string,
  outputB: string,
  task: string
): Promise<PairwiseResult> {
  const { token, headers } = await getAnthropicToken();
  const client = new Anthropic({
    apiKey: token,
    defaultHeaders: headers,
  });

  async function judge(respA: string, respB: string): Promise<{ winner: string; reasoning: string }> {
    const prompt = PAIRWISE_PROMPT
      .replace("{task}", task)
      .replace("{responseA}", respA.slice(0, 8000))
      .replace("{responseB}", respB.slice(0, 8000));

    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 256,
      system: [
      ],
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n");

    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return { winner: "tie", reasoning: "No JSON in response" };
    return JSON.parse(match[0]);
  }

  // Run both orderings to control for position bias
  const [judgmentAB, judgmentBA] = await Promise.all([
    judge(outputA, outputB),
    judge(outputB, outputA),
  ]);

  // Flip BA judgment back to A/B frame
  const flippedBA = judgmentBA.winner === "A" ? "B" : judgmentBA.winner === "B" ? "A" : "tie";

  const consistent = judgmentAB.winner === flippedBA;

  let finalWinner: string;
  if (consistent) {
    finalWinner = judgmentAB.winner === "A" ? variantA : judgmentAB.winner === "B" ? variantB : "tie";
  } else {
    finalWinner = "inconsistent";
  }

  return {
    promptId: scenario,
    variantA,
    variantB,
    winnerAB: judgmentAB.winner as "A" | "B" | "tie",
    winnerBA: flippedBA as "A" | "B" | "tie",
    consistent,
    finalWinner,
    reasoningAB: judgmentAB.reasoning,
    reasoningBA: judgmentBA.reasoning,
  };
}

export async function runPairwiseTournament(
  resultsDir: string,
  scenariosDir: string,
  baseline: string,
  candidates: string[],
  scenarios: string[]
): Promise<PairwiseResult[]> {
  const results: PairwiseResult[] = [];

  for (const scenario of scenarios) {
    const task = await readFile(join(scenariosDir, `${scenario}.md`), "utf-8");

    for (const candidate of candidates) {
      if (candidate === baseline) continue;

      // Collect all run outputs for both variants
      const baselineOutputs: string[] = [];
      const candidateOutputs: string[] = [];

      const baseDir = join(resultsDir, baseline, scenario);
      const candDir = join(resultsDir, candidate, scenario);

      const baseRuns = await readdir(baseDir).catch(() => []);
      const candRuns = await readdir(candDir).catch(() => []);

      for (const run of baseRuns) {
        try {
          baselineOutputs.push(await readFile(join(baseDir, run, "output.md"), "utf-8"));
        } catch {}
      }
      for (const run of candRuns) {
        try {
          candidateOutputs.push(await readFile(join(candDir, run, "output.md"), "utf-8"));
        } catch {}
      }

      if (baselineOutputs.length === 0 || candidateOutputs.length === 0) continue;

      // Compare best-of-each (run 1 vs run 1, run 2 vs run 2, etc.)
      const pairs = Math.min(baselineOutputs.length, candidateOutputs.length);
      for (let i = 0; i < pairs; i++) {
        const result = await pairwiseCompare(
          scenario,
          baseline,
          candidate,
          baselineOutputs[i]!,
          candidateOutputs[i]!,
          task
        );
        results.push(result);
        console.log(
          `  ${scenario}: ${baseline} vs ${candidate} #${i + 1} → ${result.finalWinner}${result.consistent ? "" : " (INCONSISTENT)"}`
        );
      }
    }
  }

  return results;
}
