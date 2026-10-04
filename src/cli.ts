#!/usr/bin/env bun
import { Command } from "commander";
import { runTrial } from "./runner";
import { gradeOutput, gradeWithMultipleJudges } from "./grader";
import { runJudgePanel, JUDGE_PANEL } from "./openrouter";
import { runPairwiseTournament } from "./pairwise";
import { gradeAllWithCodex } from "./codex-judge";
import { readdir, readFile, writeFile, stat } from "fs/promises";
import { join } from "path";

const HARNESS = import.meta.dir.replace(/\/src$/, "");
const DEFAULTS = {
  resultsDir: join(HARNESS, "results"),
  variantsDir: join(HARNESS, "variants"),
  scenariosDir: join(HARNESS, "scenarios"),
  rubricsDir: join(HARNESS, "grading"),
  model: "claude-opus-4-6",
  judgeModel: "claude-opus-4-6",
  n: 3,
  concurrency: 4,
};

const program = new Command()
  .name("eval")
  .description("Skill variant evaluation harness");

// ---- run ----
program
  .command("run")
  .description("Run a single trial")
  .argument("<variant>")
  .argument("<scenario>")
  .argument("<run_id>")
  .option("-m, --model <model>", "model to use", DEFAULTS.model)
  .action(async (variant, scenario, runId, opts) => {
    const result = await runTrial({
      variant,
      scenario,
      runId,
      model: opts.model,
      resultsDir: DEFAULTS.resultsDir,
      variantsDir: DEFAULTS.variantsDir,
      scenariosDir: DEFAULTS.scenariosDir,
    });
    console.log(
      `${result.variant} x ${result.scenario} #${result.runId}: ${result.tokens}tok ${result.durationMs}ms ${result.lines}L ${result.emdash}em ${result.doubledash}dd`
    );
  });

// ---- eval ----
program
  .command("eval")
  .description("Run all variants x scenarios x N trials")
  .option("-n, --trials <n>", "trials per combination", String(DEFAULTS.n))
  .option("-m, --model <model>", "model", DEFAULTS.model)
  .option("-c, --concurrency <n>", "max parallel runs", String(DEFAULTS.concurrency))
  .option("--variants <list>", "comma-separated variant names (default: all)")
  .option("--scenarios <list>", "comma-separated scenario names (default: all)")
  .action(async (opts) => {
    const n = parseInt(opts.trials);
    const concurrency = parseInt(opts.concurrency);

    const variants = opts.variants
      ? opts.variants.split(",")
      : (await readdir(DEFAULTS.variantsDir)).map((f: string) => f.replace(/\.md$/, ""));
    const scenarios = opts.scenarios
      ? opts.scenarios.split(",")
      : (await readdir(DEFAULTS.scenariosDir)).map((f: string) => f.replace(/\.md$/, ""));

    // Build all run configs
    const configs: Array<{ variant: string; scenario: string; runId: string }> = [];
    for (const variant of variants) {
      for (const scenario of scenarios) {
        for (let i = 1; i <= n; i++) {
          configs.push({ variant, scenario, runId: String(i) });
        }
      }
    }

    console.log(`${configs.length} runs (${variants.length} variants x ${scenarios.length} scenarios x ${n} trials), concurrency ${concurrency}`);

    // Run with concurrency limit
    let completed = 0;
    const semaphore = new Array(concurrency).fill(null);
    const queue = [...configs];

    async function worker() {
      while (queue.length > 0) {
        const config = queue.shift()!;
        try {
          const result = await runTrial({
            ...config,
            model: opts.model,
            resultsDir: DEFAULTS.resultsDir,
            variantsDir: DEFAULTS.variantsDir,
            scenariosDir: DEFAULTS.scenariosDir,
          });
          completed++;
          console.log(
            `[${completed}/${configs.length}] ${result.variant} x ${result.scenario} #${result.runId}: ${result.tokens}tok ${result.durationMs}ms ${result.lines}L`
          );
        } catch (e: any) {
          completed++;
          console.error(`[${completed}/${configs.length}] FAIL ${config.variant} x ${config.scenario} #${config.runId}: ${e.message}`);
        }
      }
    }

    await Promise.all(semaphore.map(() => worker()));
    console.log(`\n=== ${completed} runs complete ===`);
  });

// ---- grade ----
program
  .command("grade")
  .description("Blind-grade all ungraded outputs")
  .option("-j, --judge <model>", "judge model", DEFAULTS.judgeModel)
  .option("--multi-judge <models>", "comma-separated models for multi-judge consensus")
  .option("-c, --concurrency <n>", "max parallel grades", String(DEFAULTS.concurrency))
  .action(async (opts) => {
    const concurrency = parseInt(opts.concurrency);
    const judgeModels = opts.multiJudge
      ? opts.multiJudge.split(",")
      : null;

    // Find all ungraded outputs
    const configs: Array<{ variant: string; scenario: string; runId: string }> = [];
    const variants = await readdir(DEFAULTS.resultsDir).catch(() => []);

    for (const variant of variants) {
      const variantDir = join(DEFAULTS.resultsDir, variant);
      const scenarios = await readdir(variantDir).catch(() => []);
      for (const scenario of scenarios) {
        const scenarioDir = join(variantDir, scenario);
        const runs = await readdir(scenarioDir).catch(() => []);
        for (const runId of runs) {
          const dir = join(scenarioDir, runId);
          const hasOutput = await stat(join(dir, "output.md")).catch(() => null);
          const gradeFile = judgeModels ? "grades_multi.json" : "grade_parsed.json";
          const hasGrade = await stat(join(dir, gradeFile)).catch(() => null);
          if (hasOutput && !hasGrade) {
            configs.push({ variant, scenario, runId });
          }
        }
      }
    }

    if (configs.length === 0) {
      console.log("Nothing to grade");
      return;
    }

    console.log(`Grading ${configs.length} outputs${judgeModels ? ` with ${judgeModels.length} judges` : ""}...`);

    let completed = 0;
    const queue = [...configs];

    async function worker() {
      while (queue.length > 0) {
        const config = queue.shift()!;
        try {
          if (judgeModels) {
            const { consensus } = await gradeWithMultipleJudges(
              {
                ...config,
                resultsDir: DEFAULTS.resultsDir,
                rubricsDir: DEFAULTS.rubricsDir,
                judgeModel: "",
              },
              judgeModels
            );
            completed++;
            console.log(`[${completed}/${configs.length}] ${config.variant}/${config.scenario}/${config.runId}: ${consensus.total ?? consensus.score ?? "?"}/12`);
          } else {
            const grade = await gradeOutput({
              ...config,
              resultsDir: DEFAULTS.resultsDir,
              rubricsDir: DEFAULTS.rubricsDir,
              judgeModel: opts.judge,
            });
            completed++;
            console.log(`[${completed}/${configs.length}] ${config.variant}/${config.scenario}/${config.runId}: ${grade.total ?? grade.score ?? "?"}/12`);
          }
        } catch (e: any) {
          completed++;
          console.error(`[${completed}/${configs.length}] GRADE FAIL ${config.variant}/${config.scenario}/${config.runId}: ${e.message}`);
        }
      }
    }

    await Promise.all(new Array(concurrency).fill(null).map(() => worker()));
    console.log(`\n=== ${completed} grades complete ===`);
  });

// ---- panel (OpenRouter multi-model judge) ----
program
  .command("panel")
  .description("Grade all ungraded outputs with OpenRouter 5-model judge panel")
  .option("-c, --concurrency <n>", "max parallel panels", "2")
  .option("--models <list>", "comma-separated model IDs (default: core panel)")
  .action(async (opts) => {
    const concurrency = parseInt(opts.concurrency);
    const models = opts.models ? opts.models.split(",") : JUDGE_PANEL.core;

    const configs: Array<{ variant: string; scenario: string; runId: string }> = [];
    const variants = await readdir(DEFAULTS.resultsDir).catch(() => []);

    for (const variant of variants) {
      const variantDir = join(DEFAULTS.resultsDir, variant);
      const scenarios = await readdir(variantDir).catch(() => []);
      for (const scenario of scenarios) {
        const scenarioDir = join(variantDir, scenario);
        const runs = await readdir(scenarioDir).catch(() => []);
        for (const runId of runs) {
          const dir = join(scenarioDir, runId);
          const hasOutput = await stat(join(dir, "output.md")).catch(() => null);
          const hasPanel = await stat(join(dir, "panel.json")).catch(() => null);
          if (hasOutput && !hasPanel) {
            configs.push({ variant, scenario, runId });
          }
        }
      }
    }

    if (configs.length === 0) {
      console.log("Nothing to grade");
      return;
    }

    console.log(`Panel grading ${configs.length} outputs with ${models.length} judges, concurrency ${concurrency}...`);

    let completed = 0;
    const queue = [...configs];

    async function worker() {
      while (queue.length > 0) {
        const config = queue.shift()!;
        try {
          const dir = join(DEFAULTS.resultsDir, config.variant, config.scenario, config.runId);
          const output = await readFile(join(dir, "output.md"), "utf-8");

          const rubricFile = config.scenario.startsWith("blog-")
            ? "rubric-blog.md"
            : config.scenario.startsWith("ctx-")
              ? "rubric-context.md"
              : "rubric-debug.md";
          const rubric = await readFile(join(DEFAULTS.rubricsDir, rubricFile), "utf-8");

          const prompt = `${rubric}\n\n--------\n\n# Output to Grade\n\n${output}`;
          const result = await runJudgePanel(prompt, models);

          await writeFile(join(dir, "panel.json"), JSON.stringify(result, null, 2));

          completed++;
          const judgeScores = result.judges
            .map((j) => `${j.model.split("/").pop()?.slice(0, 12)}=${j.total}`)
            .join(" ");
          console.log(
            `[${completed}/${configs.length}] ${config.variant}/${config.scenario}/${config.runId}: consensus=${result.consensus.total} [${judgeScores}]`
          );
        } catch (e: any) {
          completed++;
          console.error(`[${completed}/${configs.length}] FAIL ${config.variant}/${config.scenario}/${config.runId}: ${e.message}`);
        }
      }
    }

    await Promise.all(new Array(concurrency).fill(null).map(() => worker()));
    console.log(`\n=== ${completed} panel grades complete ===`);
  });

// ---- codex-grade (GPT-5.4 xhigh) ----
program
  .command("codex-grade")
  .description("Grade debug outputs with GPT-5.4 xhigh via Codex CLI (sandboxed)")
  .action(async () => {
    console.log("Grading with GPT-5.4 xhigh (reasoning effort: xhigh)...\n");
    await gradeAllWithCodex(DEFAULTS.resultsDir, DEFAULTS.rubricsDir);
    console.log("\n=== Codex grading complete ===");
  });

// ---- pairwise ----
program
  .command("pairwise")
  .description("Run pairwise Opus tournament: each variant vs baseline")
  .option("-b, --baseline <variant>", "baseline variant", "debug-baseline")
  .option("--variants <list>", "comma-separated candidate variants")
  .option("--scenarios <list>", "comma-separated scenarios", "pod-crash,flaky-ci")
  .action(async (opts) => {
    const candidates = opts.variants
      ? opts.variants.split(",")
      : (await readdir(DEFAULTS.resultsDir)).filter((d: string) => d.startsWith("debug-") && d !== opts.baseline);
    const scenarios = opts.scenarios.split(",");

    console.log(`Pairwise tournament: ${opts.baseline} vs [${candidates.join(", ")}] on [${scenarios.join(", ")}]`);
    console.log("Using Opus 4.6 as judge (both orderings per pair)\n");

    const results = await runPairwiseTournament(
      DEFAULTS.resultsDir,
      DEFAULTS.scenariosDir,
      opts.baseline,
      candidates,
      scenarios
    );

    // Summary
    const wins: Record<string, number> = {};
    const losses: Record<string, number> = {};
    const ties: Record<string, number> = {};
    const inconsistencies: Record<string, number> = {};

    for (const r of results) {
      const cand = r.variantA === opts.baseline ? r.variantB : r.variantA;
      if (!wins[cand]) { wins[cand] = 0; losses[cand] = 0; ties[cand] = 0; inconsistencies[cand] = 0; }
      if (!r.consistent) { inconsistencies[cand] = (inconsistencies[cand] ?? 0) + 1; }
      else if (r.finalWinner === cand) { wins[cand] = (wins[cand] ?? 0) + 1; }
      else if (r.finalWinner === opts.baseline) { losses[cand] = (losses[cand] ?? 0) + 1; }
      else { ties[cand] = (ties[cand] ?? 0) + 1; }
    }

    console.log("\n=== Pairwise Results vs " + opts.baseline + " ===");
    console.log("variant".padEnd(25) + "wins".padStart(6) + "losses".padStart(8) + "ties".padStart(6) + "incon".padStart(7));
    for (const cand of Object.keys(wins).sort()) {
      console.log(
        cand.padEnd(25) +
        String(wins[cand]).padStart(6) +
        String(losses[cand]).padStart(8) +
        String(ties[cand]).padStart(6) +
        String(inconsistencies[cand]).padStart(7)
      );
    }

    await writeFile(
      join(DEFAULTS.resultsDir, "pairwise-results.json"),
      JSON.stringify({ baseline: opts.baseline, results, summary: { wins, losses, ties, inconsistencies } }, null, 2)
    );
  });

// ---- report ----
program
  .command("report")
  .description("Aggregate and display results")
  .option("--csv", "output CSV instead of table")
  .action(async (opts) => {
    const rows: any[] = [];
    const variants = await readdir(DEFAULTS.resultsDir).catch(() => []);

    for (const variant of variants) {
      const variantDir = join(DEFAULTS.resultsDir, variant);
      const scenarios = await readdir(variantDir).catch(() => []);
      for (const scenario of scenarios) {
        const scenarioDir = join(variantDir, scenario);
        const runs = await readdir(scenarioDir).catch(() => []);
        for (const runId of runs) {
          const dir = join(scenarioDir, runId);
          try {
            const metrics = JSON.parse(await readFile(join(dir, "metrics.json"), "utf-8"));
            let grade: any = {};
            try {
              const panel = JSON.parse(await readFile(join(dir, "panel.json"), "utf-8"));
              grade = panel.consensus;
            } catch {
              try {
                grade = JSON.parse(await readFile(join(dir, "grade_parsed.json"), "utf-8"));
              } catch {
                try {
                  const multi = JSON.parse(await readFile(join(dir, "grades_multi.json"), "utf-8"));
                  grade = multi.consensus;
                } catch {}
              }
            }
            // Normalize: v2 rubric uses 'score', v1 uses 'total'
            if (grade.score !== undefined && grade.total === undefined) {
              grade.total = grade.score;
            }
            rows.push({ ...metrics, ...grade });
          } catch {}
        }
      }
    }

    if (rows.length === 0) {
      console.log("No results");
      return;
    }

    if (opts.csv) {
      const keys = Object.keys(rows[0]);
      console.log(keys.join(","));
      for (const row of rows) {
        console.log(keys.map((k) => String(row[k] ?? "")).join(","));
      }
    } else {
      // Group by variant+scenario, compute means
      const groups = new Map<string, any[]>();
      for (const row of rows) {
        const key = `${row.variant}|${row.scenario}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }

      console.log(
        "variant".padEnd(22) +
          "scenario".padEnd(18) +
          "n".padStart(3) +
          "tok".padStart(8) +
          "ms".padStart(8) +
          "lines".padStart(7) +
          "em".padStart(5) +
          "dd".padStart(5) +
          "grade".padStart(7)
      );
      console.log("-".repeat(83));

      for (const [key, runs] of [...groups.entries()].sort()) {
        const [variant = "", scenario = ""] = key.split("|");
        const n = runs.length;
        const avg = (field: string) => {
          const vals = runs.map((r) => r[field]).filter((v) => typeof v === "number");
          return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : "?";
        };
        console.log(
          variant.padEnd(22) +
            scenario.padEnd(18) +
            String(n).padStart(3) +
            String(avg("tokens")).padStart(8) +
            String(avg("duration_ms")).padStart(8) +
            String(avg("lines")).padStart(7) +
            String(avg("emdash")).padStart(5) +
            String(avg("doubledash")).padStart(5) +
            String(avg("total")).padStart(7)
        );
      }
    }
  });

// ---- clean ----
program
  .command("clean")
  .description("Remove all results")
  .action(async () => {
    const { rmSync } = await import("fs");
    rmSync(DEFAULTS.resultsDir, { recursive: true, force: true });
    const { mkdirSync } = await import("fs");
    mkdirSync(DEFAULTS.resultsDir, { recursive: true });
    console.log("cleaned");
  });

program.parse();
