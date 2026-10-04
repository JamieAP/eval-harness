#!/usr/bin/env bun
/**
 * Context-eval grader: injects ground truth into the grading prompt.
 *
 * Usage: bun context-eval/run-grade.ts [--case <case-id>]
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicToken } from "../src/token";
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { join } from "path";

const HARNESS = join(import.meta.dir, "..");
const RESULTS_DIR = join(HARNESS, "results");
const RUBRIC_PATH = join(HARNESS, "grading/rubric-context.md");
const CASES_DIR = join(import.meta.dir, "cases");

interface GradeResult {
  factual_recall: number;
  continuation_coherence: number;
  staleness_awareness: number;
  decision_provenance: number;
  total: number;
  notes: string;
}

async function gradeOne(
  outputPath: string,
  groundTruthPath: string,
  rubric: string,
  model: string
): Promise<GradeResult> {
  const output = await readFile(outputPath, "utf-8");
  const groundTruth = await readFile(groundTruthPath, "utf-8");

  const prompt = [
    rubric,
    "",
    "--------",
    "",
    "# Ground Truth (facts from prior sessions)",
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
    model,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: "You are a blind grader. You do not know which context strategy produced the output. Respond with ONLY valid JSON.",
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
    throw new Error(`No JSON: ${text.slice(0, 200)}`);

  return JSON.parse(jsonMatch[0]) as GradeResult;
}

// ---- Main ----

const caseFilter = process.argv.includes("--case")
  ? process.argv[process.argv.indexOf("--case") + 1]
  : null;

const model = "claude-sonnet-4-6";
const rubric = await readFile(RUBRIC_PATH, "utf-8");
const concurrency = 4;

// Find all ctx-* result dirs
const variants = (await readdir(RESULTS_DIR).catch(() => []))
  .filter((v) => v.startsWith("ctx-"));

interface GradeJob {
  variant: string;
  scenario: string;
  runId: string;
  caseId: string;
  outputPath: string;
  groundTruthPath: string;
  gradePath: string;
}

const jobs: GradeJob[] = [];

for (const variant of variants) {
  // Extract case ID from variant name: ctx-<case>-<strategy>
  const match = variant.match(/^ctx-(.+?)-(full|ring-\d+|map-only|log-map-\d+|cold|recap|memory)$/);
  if (!match) continue;
  const caseId = match[1]!;

  if (caseFilter && caseId !== caseFilter) continue;

  const groundTruthPath = join(CASES_DIR, caseId, "ground-truth.md");
  try {
    await stat(groundTruthPath);
  } catch {
    console.log(`  skip ${variant}: no ground truth for case ${caseId}`);
    continue;
  }

  const variantDir = join(RESULTS_DIR, variant);
  const scenarios = await readdir(variantDir).catch(() => []);
  for (const scenario of scenarios) {
    const scenarioDir = join(variantDir, scenario);
    const runs = await readdir(scenarioDir).catch(() => []);
    for (const runId of runs) {
      const dir = join(scenarioDir, runId);
      const outputPath = join(dir, "output.md");
      const gradePath = join(dir, "ctx_grade.json");

      const hasOutput = await stat(outputPath).catch(() => null);
      const hasGrade = await stat(gradePath).catch(() => null);

      if (hasOutput && !hasGrade) {
        jobs.push({
          variant,
          scenario,
          runId,
          caseId,
          outputPath,
          groundTruthPath,
          gradePath,
        });
      }
    }
  }
}

if (jobs.length === 0) {
  console.log("Nothing to grade");
  process.exit(0);
}

console.log(`Grading ${jobs.length} outputs with ground truth injection...\n`);

let completed = 0;
const queue = [...jobs];

async function worker() {
  while (queue.length > 0) {
    const job = queue.shift()!;
    try {
      const grade = await gradeOne(
        job.outputPath,
        job.groundTruthPath,
        rubric,
        model
      );
      await writeFile(job.gradePath, JSON.stringify(grade, null, 2));
      completed++;
      const strategy = job.variant.replace(`ctx-${job.caseId}-`, "");
      console.log(
        `[${completed}/${jobs.length}] ${job.caseId} / ${strategy.padEnd(12)} → ${grade.total}/12  [fr=${grade.factual_recall} cc=${grade.continuation_coherence} sa=${grade.staleness_awareness} dp=${grade.decision_provenance}]  ${grade.notes}`
      );
    } catch (e: any) {
      completed++;
      console.error(`[${completed}/${jobs.length}] FAIL ${job.variant}: ${e.message.slice(0, 100)}`);
    }
  }
}

await Promise.all(new Array(concurrency).fill(null).map(() => worker()));

// ---- Summary ----
console.log("\n=== Summary ===\n");

const results = new Map<string, Map<string, GradeResult>>();
for (const job of jobs) {
  try {
    const grade = JSON.parse(
      await readFile(job.gradePath, "utf-8")
    ) as GradeResult;
    const strategy = job.variant.replace(`ctx-${job.caseId}-`, "");
    if (!results.has(strategy)) results.set(strategy, new Map());
    results.get(strategy)!.set(job.caseId, grade);
  } catch {}
}

// Print summary table
const strategies = [...results.keys()].sort();
const cases = [...new Set(jobs.map((j) => j.caseId))].sort();

console.log(
  "strategy".padEnd(14) +
    cases.map((c) => c.padStart(14)).join("") +
    "avg".padStart(8)
);
console.log("-".repeat(14 + cases.length * 14 + 8));

for (const strategy of strategies) {
  const grades = results.get(strategy)!;
  const totals = cases.map((c) => grades.get(c)?.total ?? NaN);
  const avg =
    totals.filter((t) => !isNaN(t)).reduce((a, b) => a + b, 0) /
    totals.filter((t) => !isNaN(t)).length;
  console.log(
    strategy.padEnd(14) +
      totals.map((t) => (isNaN(t) ? "-".padStart(14) : `${t}/12`.padStart(14))).join("") +
      (isNaN(avg) ? "-".padStart(8) : avg.toFixed(1).padStart(8))
  );
}
