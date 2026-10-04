import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicToken } from "./token";
import { readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";

export interface RunConfig {
  variant: string;
  scenario: string;
  runId: string;
  model: string;
  resultsDir: string;
  variantsDir: string;
  scenariosDir: string;
}

export interface RunResult {
  variant: string;
  scenario: string;
  runId: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  lines: number;
  words: number;
  emdash: number;
  doubledash: number;
  output: string;
}

export async function runTrial(config: RunConfig): Promise<RunResult> {
  const variantPath = join(config.variantsDir, `${config.variant}.md`);
  const scenarioPath = join(config.scenariosDir, `${config.scenario}.md`);

  const [skillText, scenarioText] = await Promise.all([
    readFile(variantPath, "utf-8"),
    readFile(scenarioPath, "utf-8"),
  ]);

  const prompt = `${scenarioText}`;
  const systemPrompt = skillText;

  // Read an explicit provider API key.
  const { token, headers } = await getAnthropicToken();

  const client = new Anthropic({
    apiKey: token,
    defaultHeaders: headers,
  });

  const start = performance.now();

  // Send the selected context as the system prompt.
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    system: [
      { type: "text", text: systemPrompt },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const durationMs = Math.round(performance.now() - start);

  const output = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n");

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  // Count formatting signals
  const emdash = (output.match(/—/g) || []).length;
  const doubledash = (output.match(/ -- /g) || []).length;
  const lines = output.split("\n").length;
  const words = output.split(/\s+/).filter(Boolean).length;

  // Save results
  const dir = join(config.resultsDir, config.variant, config.scenario, config.runId);
  await mkdir(dir, { recursive: true });

  await Promise.all([
    writeFile(join(dir, "output.md"), output),
    writeFile(
      join(dir, "metrics.json"),
      JSON.stringify({
        variant: config.variant,
        scenario: config.scenario,
        run_id: config.runId,
        tokens: inputTokens + outputTokens,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        duration_ms: durationMs,
        lines,
        words,
        emdash,
        doubledash,
        model: config.model,
      })
    ),
  ]);

  return {
    variant: config.variant,
    scenario: config.scenario,
    runId: config.runId,
    tokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    durationMs,
    lines,
    words,
    emdash,
    doubledash,
    output,
  };
}
