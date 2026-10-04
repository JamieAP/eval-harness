import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicToken } from "./token";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

export interface GradeResult {
  methodology?: number;
  root_cause?: number;
  actionability?: number;
  voice?: number;
  technical_depth?: number;
  structure?: number;
  conciseness?: number;
  emdash_count?: number;
  doubledash_count?: number;
  total: number;
  score?: number;
  notes: string;
}

interface GradeConfig {
  variant: string;
  scenario: string;
  runId: string;
  resultsDir: string;
  rubricsDir: string;
  judgeModel: string;
}

export async function gradeOutput(config: GradeConfig): Promise<GradeResult> {
  const dir = join(config.resultsDir, config.variant, config.scenario, config.runId);
  const outputPath = join(dir, "output.md");
  const output = await readFile(outputPath, "utf-8");

  // Pick rubric based on scenario type -- v2 (binary) rubrics preferred
  const hardScenarios = ["debug-ambiguous-perf", "debug-misleading-symptom", "debug-multi-cause", "debug-wrong-hypothesis"];
  let rubricFile = hardScenarios.includes(config.scenario) ? "rubric-debug-hard.md" : "rubric-debug-v2.md";
  if (config.scenario.startsWith("blog-")) rubricFile = "rubric-blog.md";
  else if (config.scenario.startsWith("verify-")) rubricFile = "rubric-verify.md";
  else if (config.scenario.startsWith("brainstorm-")) rubricFile = "rubric-brainstorm.md";
  else if (config.scenario.startsWith("ctx-")) rubricFile = "rubric-context.md";
  else if (config.scenario.startsWith("impl-")) rubricFile = "rubric-impl.md";
  const rubric = await readFile(join(config.rubricsDir, rubricFile), "utf-8");

  const prompt = `${rubric}\n\n--------\n\n# Output to Grade\n\n${output}`;

  const { token, headers } = await getAnthropicToken();
  const client = new Anthropic({
    apiKey: token,
    defaultHeaders: headers,
  });

  const response = await client.messages.create({
    model: config.judgeModel,
    max_tokens: 1024,
    system: [
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n");

  // Extract JSON from response (may be wrapped in markdown fences)
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in grade response: ${text.slice(0, 200)}`);

  const grade = JSON.parse(jsonMatch[0]) as GradeResult;

  await writeFile(join(dir, "grade_parsed.json"), JSON.stringify(grade, null, 2));

  return grade;
}

export async function gradeWithMultipleJudges(
  config: GradeConfig,
  judgeModels: string[]
): Promise<{ grades: Record<string, GradeResult>; consensus: GradeResult }> {
  const grades: Record<string, GradeResult> = {};

  // Run all judges in parallel
  const results = await Promise.allSettled(
    judgeModels.map(async (model) => {
      const grade = await gradeOutput({ ...config, judgeModel: model });
      return { model, grade };
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      grades[r.value.model] = r.value.grade;
    }
  }

  // Consensus: median of each dimension
  const allGrades = Object.values(grades);
  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };

  // Get all numeric keys from first grade
  const numericKeys = Object.keys(allGrades[0] || {}).filter(
    (k) => typeof (allGrades[0] as any)[k] === "number"
  );

  const consensus: any = { notes: "multi-judge consensus (median)" };
  let total = 0;
  for (const key of numericKeys) {
    const values = allGrades.map((g) => (g as any)[key]).filter((v) => typeof v === "number");
    if (values.length > 0) {
      consensus[key] = median(values);
      if (!key.includes("count") && key !== "total") total += consensus[key];
    }
  }
  consensus.total = total;

  const dir = join(config.resultsDir, config.variant, config.scenario, config.runId);
  await writeFile(join(dir, "grades_multi.json"), JSON.stringify({ grades, consensus }, null, 2));

  return { grades, consensus };
}
