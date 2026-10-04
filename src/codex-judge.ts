import { readFile, writeFile, readdir, stat } from "fs/promises";
import { join } from "path";

interface CodexGrade {
  model: string;
  scores: Record<string, boolean>;
  score: number;
  notes: string;
  durationMs: number;
}

export async function gradeWithCodex(
  outputPath: string,
  rubricPath: string,
  outPath: string
): Promise<CodexGrade> {
  const output = await readFile(outputPath, "utf-8");
  const rubric = await readFile(rubricPath, "utf-8");
  const prompt = `${rubric}\n\n${output}`;

  const start = performance.now();

  const proc = Bun.spawn(
    [
      "codex", "exec",
      "--sandbox", "read-only",
      "-m", "gpt-5.4",
      "-c", 'model_reasoning_effort="xhigh"',
      "-o", outPath,
      "-",
    ],
    {
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  await proc.exited;
  const durationMs = Math.round(performance.now() - start);

  const raw = await readFile(outPath, "utf-8").catch(() => "");

  // Parse JSON from response
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);

  if (!match) {
    return { model: "gpt-5.4-xhigh", scores: {}, score: -1, notes: "No JSON", durationMs };
  }

  const parsed = JSON.parse(match[0]);
  const boolKeys = Object.entries(parsed).filter(([, v]) => typeof v === "boolean");
  const score = parsed.score ?? boolKeys.filter(([, v]) => v === true).length;

  return {
    model: "gpt-5.4-xhigh",
    scores: Object.fromEntries(boolKeys.map(([key, value]) => [key, value === true])),
    score,
    notes: parsed.notes ?? "",
    durationMs,
  };
}

export async function gradeAllWithCodex(
  resultsDir: string,
  rubricsDir: string,
  scenarios: string[] = ["pod-crash", "flaky-ci"]
): Promise<void> {
  const rubric = join(rubricsDir, "rubric-debug-v2.md");
  const variants = await readdir(resultsDir).catch(() => []);

  for (const variant of variants) {
    if (!variant.startsWith("debug-")) continue;
    const variantDir = join(resultsDir, variant);
    for (const scenario of scenarios) {
      const scenarioDir = join(variantDir, scenario);
      const runs = await readdir(scenarioDir).catch(() => []);
      for (const runId of runs) {
        const dir = join(scenarioDir, runId);
        const outputFile = join(dir, "output.md");
        const gradeFile = join(dir, "grade_codex.json");

        const hasOutput = await stat(outputFile).catch(() => null);
        const hasGrade = await stat(gradeFile).catch(() => null);
        if (!hasOutput || hasGrade) continue;

        try {
          const result = await gradeWithCodex(outputFile, rubric, join(dir, "codex_raw.txt"));
          await writeFile(gradeFile, JSON.stringify(result, null, 2));
          console.log(`  ${variant}/${scenario}/${runId}: ${result.score}/10 (codex)`);
        } catch (e: any) {
          console.error(`  FAIL ${variant}/${scenario}/${runId}: ${e.message}`);
        }
      }
    }
  }
}
