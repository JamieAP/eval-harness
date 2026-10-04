/** Export an explicitly selected JSON corpus. No local history, memory, or database is read. */
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { defaultStrategies, type SessionEntry } from "./strategies";

export interface Corpus {
  id: string;
  synthetic: boolean;
  entries: SessionEntry[];
  task: string;
  groundTruth: string;
  recap?: string;
  memory?: string;
}
export interface ExportOptions { outputDir?: string; public?: boolean; }
function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

/** Normalize aliases of the harness without following symlinks inside its export tree. */
async function normalizeHarnessAlias(output: string, harness: string): Promise<string> {
  let ancestor = output;
  const children: string[] = [];
  while (true) {
    try { if (await realpath(ancestor) === harness) return join(harness, ...children); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) return output;
    children.unshift(basename(ancestor));
    ancestor = parent;
  }
}

/** Check all existing ancestors and the destination before any export writes. */
async function checkPrivatePath(privateRoot: string, destination: string): Promise<void> {
  const components = relative(privateRoot, destination).split(sep).filter(Boolean);
  let path = privateRoot;
  for (let index = 0; index <= components.length; index++) {
    if (index > 0) path = join(path, components[index - 1]!);
    let stat;
    try { stat = await lstat(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error("Private export rejects symlink paths");
    if (index < components.length && !stat.isDirectory()) throw new Error("Private export ancestor must be a directory");
    if (index === components.length && (!stat.isFile() || stat.nlink !== 1)) {
      throw new Error("Private export destination must be a regular file without hard links");
    }
  }
}

function validateCorpus(value: Corpus): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id ?? "")) throw new Error("Invalid corpus identifier");
  if (typeof value.synthetic !== "boolean") throw new Error("Corpus must declare whether it is synthetic");
  if (!value.task?.trim() || !value.groundTruth?.trim()) throw new Error("Task and ground truth are required");
  if (!Array.isArray(value.entries) || !value.entries.length) throw new Error("Corpus entries are required");
  for (const entry of value.entries) {
    if (!Number.isFinite(Date.parse(entry.timestamp)) || !entry.project?.trim() || !entry.focus?.trim() ||
        !entry.done?.trim() || !Array.isArray(entry.files) || entry.files.some((file) => typeof file !== "string")) {
      throw new Error("Invalid session entry");
    }
  }
}
export async function exportCorpus(corpus: Corpus, options: ExportOptions = {}): Promise<void> {
  validateCorpus(corpus);
  const cwd = await realpath(process.cwd());
  const harness = await realpath(join(import.meta.dir, ".."));
  const privateRoot = join(harness, "private-corpora");
  const output = await normalizeHarnessAlias(resolve(cwd, options.outputDir ?? privateRoot), harness);
  const privateOutput = isWithin(privateRoot, output);
  if (!privateOutput && !options.public) throw new Error("Output outside private-corpora requires --public and a reviewed synthetic corpus");
  if (options.public && !corpus.synthetic) throw new Error("Public export requires a reviewed synthetic corpus");
  if (options.public && !options.outputDir) throw new Error("Public export requires an explicit output directory");
  const caseDir = join(output, "context-eval", "cases", corpus.id);
  const entries = [...corpus.entries].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const provenance = corpus.synthetic ? "Synthetic example; all events and decisions are invented." : "Private caller-provided corpus; review before sharing.";
  const files: { path: string; content: string }[] = [
    { path: join(caseDir, "entries.json"), content: JSON.stringify(entries, null, 2) + "\n" },
    { path: join(caseDir, "meta.json"), content: JSON.stringify({ id: corpus.id, synthetic: corpus.synthetic, provenance }, null, 2) + "\n" },
    { path: join(caseDir, "task.md"), content: corpus.task + "\n" },
    { path: join(caseDir, "ground-truth.md"), content: `# Expected facts\n\n${provenance}\n\n${corpus.groundTruth}\n` },
    { path: join(output, "scenarios", `ctx-${corpus.id}.md`), content: `${provenance}\n\n${corpus.task}\n` },
  ];
  for (const strategy of defaultStrategies({ recapOutput: corpus.recap, memoryContent: corpus.memory })) {
    const context = strategy.apply(entries);
    files.push({ path: join(caseDir, "variants", `${strategy.name}.md`), content: context + "\n" });
    files.push({ path: join(output, "variants", `ctx-${corpus.id}-${strategy.name}.md`), content: `${provenance}\n\n${context}\n` });
  }
  if (privateOutput) for (const file of files) await checkPrivatePath(privateRoot, file.path);
  await mkdir(join(caseDir, "variants"), { recursive: true });
  await mkdir(join(output, "variants"), { recursive: true });
  await mkdir(join(output, "scenarios"), { recursive: true });
  for (const file of files) await writeFile(file.path, file.content);
}
if (import.meta.main) {
  const { values } = parseArgs({ options: { input: { type: "string" }, output: { type: "string" }, public: { type: "boolean", default: false } } });
  if (!values.input) throw new Error("Usage: corpus-builder.ts --input CORPUS.json [--output DIRECTORY] [--public]");
  const corpus = JSON.parse(await readFile(resolve(values.input), "utf8")) as Corpus;
  await exportCorpus(corpus, { outputDir: values.output, public: values.public });
  console.log(`Exported corpus ${corpus.id}; inspect the output before sharing.`);
}
