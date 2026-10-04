/**
 * Context-aware grader.
 *
 * Extends the base grader with ground truth injection.
 * The grader sees: rubric + ground truth + agent output.
 * It does NOT see which strategy produced the output (blind grading).
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicToken } from "../src/token";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

export interface ContextGradeResult {
  factual_recall: number;
  continuation_coherence: number;
  staleness_awareness: number;
  decision_provenance: number;
  total: number;
  notes: string;
}

interface ContextGradeConfig {
  caseId: string;
  strategy: string;
  runId: string;
  casesDir: string;
  resultsDir: string;
  rubricsDir: string;
  judgeModel: string;
}

export async function gradeContextOutput(
  config: ContextGradeConfig
): Promise<ContextGradeResult> {
  const outputDir = join(
    config.resultsDir,
    `ctx-${config.caseId}-${config.strategy}`,
    `ctx-${config.caseId}`,
    config.runId
  );
  const output = await readFile(join(outputDir, "output.md"), "utf-8");

  const groundTruth = await readFile(
    join(config.casesDir, config.caseId, "ground-truth.md"),
    "utf-8"
  );

  const rubric = await readFile(
    join(config.rubricsDir, "rubric-context.md"),
    "utf-8"
  );

  const prompt = [
    rubric,
    "",
    "--------",
    "",
    "# Ground Truth (facts from prior sessions - the source of truth)",
    "",
    groundTruth,
    "",
    "--------",
    "",
    "# Agent Output (to grade)",
    "",
    output,
  ].join("\n");

  const { token, headers } = await getAnthropicToken();
  const client = new Anthropic({
    apiKey: token,
    defaultHeaders: headers,
  });

  const response = await client.messages.create({
    model: config.judgeModel,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: "You are a blind grader. You do not know which context strategy produced the output.",
      },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n");

  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch)
    throw new Error(`No JSON in grade response: ${text.slice(0, 200)}`);

  const grade = JSON.parse(jsonMatch[0]) as ContextGradeResult;

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "context_grade.json"),
    JSON.stringify(grade, null, 2)
  );

  return grade;
}
