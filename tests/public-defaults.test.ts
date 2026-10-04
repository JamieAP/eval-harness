import { afterEach, expect, test } from "bun:test";
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getAnthropicToken } from "../src/token";
import { getOpenRouterKey } from "../src/openrouter";
import { exportCorpus, type Corpus } from "../context-eval/corpus-builder";

const saved = { anthropic: process.env.ANTHROPIC_API_KEY, router: process.env.OPENROUTER_API_KEY };
const originalCwd = process.cwd();
const tempDirs: string[] = [];
afterEach(async () => {
  process.chdir(originalCwd);
  for (const [key, value] of [["ANTHROPIC_API_KEY", saved.anthropic], ["OPENROUTER_API_KEY", saved.router]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test("provider credentials require explicit API keys, without fetching local brokers", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  await expect(getAnthropicToken()).rejects.toThrow("ANTHROPIC_API_KEY");
  await expect(getOpenRouterKey()).rejects.toThrow("OPENROUTER_API_KEY");
  process.env.ANTHROPIC_API_KEY = "unit-test-only";
  process.env.OPENROUTER_API_KEY = "unit-test-only";
  expect(await getAnthropicToken()).toEqual({ token: "unit-test-only", headers: {} });
  expect(await getOpenRouterKey()).toBe("unit-test-only");
});

const corpus: Corpus = {
  id: "demo-cache", synthetic: true,
  task: "Which cache policy was selected?", groundTruth: "A bounded LRU cache.",
  entries: [
    { timestamp: "2025-01-01T09:00:00Z", project: "demo-cache", focus: "Choose cache policy", done: "Selected a bounded LRU cache.", files: ["src/cache.ts"] },
    { timestamp: "2025-01-02T09:00:00Z", project: "demo-cache", focus: "Set cache limit", done: "Set a limit of 64 entries.", files: ["src/cache.ts"] },
  ],
};
async function outputDir() { const dir = await mkdtemp(join(tmpdir(), "eval-public-test-")); tempDirs.push(dir); return dir; }
async function isolatedExporter(workspace: string): Promise<typeof exportCorpus> {
  const contextDir = join(workspace, "context-eval");
  await mkdir(contextDir);
  for (const name of ["corpus-builder.ts", "strategies.ts"]) {
    await copyFile(join(import.meta.dir, "..", "context-eval", name), join(contextDir, name));
  }
  return (await import(pathToFileURL(join(contextDir, "corpus-builder.ts")).href)).exportCorpus;
}

test("synthetic export preserves task, ground truth, chronological context and strategy selection", async () => {
  const dir = await outputDir();
  await exportCorpus(corpus, { outputDir: dir, public: true });
  expect(await readFile(join(dir, "scenarios/ctx-demo-cache.md"), "utf8")).toContain(corpus.task);
  expect(await readFile(join(dir, "context-eval/cases/demo-cache/ground-truth.md"), "utf8")).toContain(corpus.groundTruth);
  const full = await readFile(join(dir, "variants/ctx-demo-cache-full.md"), "utf8");
  const recent = await readFile(join(dir, "variants/ctx-demo-cache-ring-1.md"), "utf8");
  expect(full).toContain("Selected a bounded LRU cache.");
  expect(recent).not.toContain("Selected a bounded LRU cache.");
  expect(recent).toContain("64 entries");
  expect(await readFile(join(dir, "variants/ctx-demo-cache-cold.md"), "utf8")).not.toContain("64 entries");
});

test("public exporter rejects private corpora and unsafe identifiers before writing", async () => {
  const dir = await outputDir();
  await expect(exportCorpus({ ...corpus, synthetic: false }, { outputDir: dir, public: true })).rejects.toThrow("synthetic");
  await expect(exportCorpus({ ...corpus, id: "../escape" }, { outputDir: dir, public: true })).rejects.toThrow("identifier");
  expect(await readdir(dir)).toEqual([]);
});

test("private corpus export accepts a custom destination within the ignored subtree", async () => {
  const workspace = await outputDir();
  const exportPrivate = await isolatedExporter(workspace);
  process.chdir(workspace);
  const dir = join(workspace, "private-corpora", "local-case");
  await exportPrivate({ ...corpus, synthetic: false }, { outputDir: dir });
  expect(JSON.parse(await readFile(join(dir, "context-eval/cases/demo-cache/entries.json"), "utf8"))).toHaveLength(2);
});

test("private default stays in the harness when invoked from another working directory", async () => {
  const workspace = await outputDir();
  const exportPrivate = await isolatedExporter(workspace);
  const caller = await outputDir();
  process.chdir(caller);
  await exportPrivate({ ...corpus, synthetic: false });
  expect(await readFile(join(workspace, "private-corpora", "context-eval", "cases", corpus.id, "task.md"), "utf8")).toContain(corpus.task);
  expect(await readdir(caller)).toEqual([]);
});

test("private input cannot bypass the public gate with a publishable output directory", async () => {
  const workspace = await outputDir();
  const exportPrivate = await isolatedExporter(workspace);
  process.chdir(workspace);
  await expect(exportPrivate({ ...corpus, synthetic: false }, { outputDir: "." })).rejects.toThrow("--public");
  expect(await readdir(workspace)).toEqual(["context-eval"]);
});

test("synthetic input also requires an explicit public flag outside private-corpora", async () => {
  const workspace = await outputDir();
  const exportPrivate = await isolatedExporter(workspace);
  process.chdir(workspace);
  await expect(exportPrivate(corpus, { outputDir: "publishable" })).rejects.toThrow("--public");
  expect(await readdir(workspace)).toEqual(["context-eval"]);
});

test("private destination containment rejects traversal and sibling-prefix paths before writes", async () => {
  const workspace = await outputDir();
  const exportPrivate = await isolatedExporter(workspace);
  const outside = await outputDir();
  process.chdir(workspace);
  for (const path of ["private-corpora/..", "private-corpora-exports", outside]) {
    await expect(exportPrivate({ ...corpus, synthetic: false }, { outputDir: path })).rejects.toThrow("--public");
  }
  expect(await readdir(workspace)).toEqual(["context-eval"]);
  expect(await readdir(outside)).toEqual([]);
});

test("private output rejects a symlinked private root before writing through it", async () => {
  const workspace = await outputDir();
  const exportPrivate = await isolatedExporter(workspace);
  const outside = await outputDir();
  process.chdir(workspace);
  await symlink(outside, join(workspace, "private-corpora"));
  await expect(exportPrivate({ ...corpus, synthetic: false }, { outputDir: "private-corpora" })).rejects.toThrow("symlink");
  expect(await readdir(outside)).toEqual([]);
});

test("private custom output rejects a symlinked descendant before any writes", async () => {
  const workspace = await outputDir();
  const exportPrivate = await isolatedExporter(workspace);
  const outside = await outputDir();
  process.chdir(workspace);
  await mkdir(join(workspace, "private-corpora"));
  await symlink(outside, join(workspace, "private-corpora", "alias"));
  await expect(exportPrivate({ ...corpus, synthetic: false }, { outputDir: "private-corpora/alias/case" })).rejects.toThrow("symlink");
  expect(await readdir(join(workspace, "private-corpora"))).toEqual(["alias"]);
  expect(await readdir(outside)).toEqual([]);
});

test("private generated subdirectories are checked before creating other export paths", async () => {
  const workspace = await outputDir();
  const exportPrivate = await isolatedExporter(workspace);
  const outside = await outputDir();
  process.chdir(workspace);
  await mkdir(join(workspace, "private-corpora"));
  await symlink(outside, join(workspace, "private-corpora", "context-eval"));
  await expect(exportPrivate({ ...corpus, synthetic: false }, { outputDir: "private-corpora" })).rejects.toThrow("symlink");
  expect(await readdir(join(workspace, "private-corpora"))).toEqual(["context-eval"]);
  expect(await readdir(outside)).toEqual([]);
});

test("private export rejects a symlinked output file without overwriting its target", async () => {
  const workspace = await outputDir();
  const exportPrivate = await isolatedExporter(workspace);
  const outside = await outputDir();
  process.chdir(workspace);
  const caseDir = join(workspace, "private-corpora", "context-eval", "cases", corpus.id);
  await mkdir(caseDir, { recursive: true });
  const target = join(outside, "unchanged.txt");
  await writeFile(target, "unchanged");
  await symlink(target, join(caseDir, "entries.json"));
  await expect(exportPrivate({ ...corpus, synthetic: false }, { outputDir: "private-corpora" })).rejects.toThrow("symlink");
  expect(await readFile(target, "utf8")).toBe("unchanged");
  expect(await readdir(caseDir)).toEqual(["entries.json"]);
});

test("private export rejects a hard-linked output file without changing the shared target", async () => {
  const workspace = await outputDir();
  const exportPrivate = await isolatedExporter(workspace);
  const outside = await outputDir();
  process.chdir(workspace);
  const caseDir = join(workspace, "private-corpora", "context-eval", "cases", corpus.id);
  await mkdir(caseDir, { recursive: true });
  const target = join(outside, "unchanged.txt");
  await writeFile(target, "unchanged");
  await link(target, join(caseDir, "entries.json"));
  await expect(exportPrivate({ ...corpus, synthetic: false }, { outputDir: "private-corpora" })).rejects.toThrow("hard links");
  expect(await readFile(target, "utf8")).toBe("unchanged");
  expect(await readdir(caseDir)).toEqual(["entries.json"]);
});

test("context grader locates the same ctx case and output names as exported fixtures", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { gradeContextOutput } = await import("../context-eval/grader");
  const dir = await outputDir();
  await exportCorpus(corpus, { outputDir: dir, public: true });
  const output = join(dir, "results/ctx-demo-cache-full/ctx-demo-cache/1");
  await mkdir(output, { recursive: true });
  await mkdir(join(dir, "grading"));
  await writeFile(join(output, "output.md"), "A bounded LRU cache.");
  await writeFile(join(dir, "grading/rubric-context.md"), "Grade factual recall.");
  delete process.env.ANTHROPIC_API_KEY;
  await expect(gradeContextOutput({ caseId: "demo-cache", strategy: "full", runId: "1",
    casesDir: join(dir, "context-eval/cases"), resultsDir: join(dir, "results"),
    rubricsDir: join(dir, "grading"), judgeModel: "unused-offline" })).rejects.toThrow("ANTHROPIC_API_KEY");
});

test("trial uses explicit API-key authentication and only the selected synthetic fixtures", async () => {
  const { runTrial } = await import("../src/runner");
  const dir = await outputDir();
  await exportCorpus(corpus, { outputDir: dir, public: true });
  process.env.ANTHROPIC_API_KEY = "unit-test-only";
  const originalFetch = globalThis.fetch;
  let captured: { headers: Headers; body: any } | undefined;
  globalThis.fetch = (async (_url: any, init: any) => {
    captured = { headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ id: "msg_synthetic", type: "message", role: "assistant", model: "test-model",
      content: [{ type: "text", text: "The fictional cache uses bounded LRU." }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 8 } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await runTrial({ variant: "ctx-demo-cache-full", scenario: "ctx-demo-cache", runId: "1", model: "test-model",
      variantsDir: join(dir, "variants"), scenariosDir: join(dir, "scenarios"), resultsDir: join(dir, "results") });
    expect(captured?.headers.get("x-api-key")).toBe("unit-test-only");
    expect(captured?.headers.get("authorization")).toBeNull();
    expect(JSON.stringify(captured?.body.system)).toContain("Selected a bounded LRU cache.");
    expect(JSON.stringify(captured?.body.system)).not.toContain("Claude Code");
    expect(result.output).toContain("fictional cache");
    expect(await readFile(join(dir, "results/ctx-demo-cache-full/ctx-demo-cache/1/output.md"), "utf8")).toBe(result.output);
  } finally { globalThis.fetch = originalFetch; }
});
