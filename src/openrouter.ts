const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function getOpenRouterKey(): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY must be set");
  return key;
}

export interface JudgeResult {
  model: string;
  scores: Record<string, number>;
  total: number;
  notes: string;
  raw: string;
  durationMs: number;
  error?: string;
}

export const JUDGE_PANEL = {
  core: [
    "openai/gpt-5.4-mini",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "stepfun/step-3.5-flash:free",
  ],
  expansion: [
    "minimax/minimax-m2.5:free",
    "arcee-ai/trinity-large-preview:free",
  ],
  tiebreaker: [
    "openai/gpt-5.4",
    "anthropic/claude-haiku-4.5",
  ],
};

async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  retries = 3,
  baseDelay = 2000
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch(url, opts);
    if (resp.status === 429 && attempt < retries) {
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return resp;
  }
  throw new Error("unreachable");
}

export async function callJudge(
  model: string,
  rubricPrompt: string
): Promise<JudgeResult> {
  const apiKey = await getOpenRouterKey();
  const start = performance.now();

  try {
    const resp = await fetchWithRetry(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://eval-harness.local",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: rubricPrompt }],
        max_tokens: 1024,
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        model,
        scores: {},
        total: -1,
        notes: `API error: ${resp.status}`,
        raw: errText,
        durationMs: Math.round(performance.now() - start),
        error: errText,
      };
    }

    const data = (await resp.json()) as any;
    const text = data.choices?.[0]?.message?.content ?? "";
    const durationMs = Math.round(performance.now() - start);

    // Extract JSON from response
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return {
        model,
        scores: {},
        total: 0,
        notes: "No JSON in response",
        raw: text.slice(0, 500),
        durationMs,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const numericKeys = Object.entries(parsed).filter(
      ([k, v]) => typeof v === "number" && !k.includes("count") && k !== "total"
    );
    const total =
      parsed.total ??
      numericKeys.reduce((sum, [, v]) => sum + (v as number), 0);

    return {
      model,
      scores: Object.fromEntries(numericKeys.map(([key, value]) => [key, Number(value)])),
      total,
      notes: parsed.notes ?? "",
      raw: text.slice(0, 1000),
      durationMs,
    };
  } catch (e: any) {
    return {
      model,
      scores: {},
      total: -1,
      notes: e.message,
      raw: "",
      durationMs: Math.round(performance.now() - start),
      error: e.message,
    };
  }
}

export async function runJudgePanel(
  rubricPrompt: string,
  models: string[] = JUDGE_PANEL.core
): Promise<{
  judges: JudgeResult[];
  consensus: { scores: Record<string, number>; total: number };
}> {
  // Run judges sequentially to avoid rate limit storms on free tiers
  const judges: JudgeResult[] = [];
  for (const model of models) {
    judges.push(await callJudge(model, rubricPrompt));
  }

  // Filter out errors
  const valid = judges.filter((j) => j.total >= 0);

  if (valid.length === 0) {
    return {
      judges,
      consensus: { scores: {}, total: 0 },
    };
  }

  // Trimmed mean: drop highest and lowest total, average the rest
  const sorted = [...valid].sort((a, b) => a.total - b.total);
  const trimmed =
    sorted.length >= 3
      ? sorted.slice(1, -1) // drop min and max
      : sorted; // keep all if < 3

  // Aggregate scores per dimension
  const allKeys = new Set<string>();
  for (const j of trimmed) {
    for (const k of Object.keys(j.scores)) allKeys.add(k);
  }

  const consensusScores: Record<string, number> = {};
  for (const key of allKeys) {
    const vals = trimmed
      .map((j) => j.scores[key])
      .filter((v) => typeof v === "number");
    if (vals.length > 0) {
      consensusScores[key] =
        Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    }
  }

  const consensusTotal =
    Math.round(
      (trimmed.reduce((sum, j) => sum + j.total, 0) / trimmed.length) * 10
    ) / 10;

  return {
    judges,
    consensus: { scores: consensusScores, total: consensusTotal },
  };
}
