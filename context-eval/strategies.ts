/**
 * Context strategy implementations.
 *
 * Each strategy takes recap-quality session entries and produces a markdown
 * document that becomes the system prompt (the "context" the agent sees).
 *
 * Session entries are LLM-summarized
 * into (focus, done) pairs per session. Strategies differ in selection
 * and organization, not in information quality.
 */

export interface SessionEntry {
  /** ISO timestamp (session start) */
  timestamp: string;
  /** Repo/project name */
  project: string;
  /** What was the session about (LLM-synthesized focus line) */
  focus: string;
  /** What was accomplished (LLM-synthesized done line) */
  done: string;
  /** Files modified (from file_diff events) */
  files: string[];
}

export interface ContextStrategy {
  name: string;
  description: string;
  apply(entries: SessionEntry[]): string;
}

function renderEntry(e: SessionEntry): string {
  const lines = [
    `### ${e.project} (${e.timestamp})`,
    `**Focus:** ${e.focus}`,
    `**Done:** ${e.done}`,
  ];
  if (e.files.length > 0) {
    lines.push(`**Files:** ${e.files.slice(0, 10).join(", ")}${e.files.length > 10 ? ` (+${e.files.length - 10} more)` : ""}`);
  }
  return lines.join("\n");
}

// ---- Strategy: full ----
export const full: ContextStrategy = {
  name: "full",
  description: "Complete session history - upper bound on information",
  apply(entries) {
    if (entries.length === 0) return "";
    return `# Full Session History (${entries.length} sessions)\n\n${entries.map(renderEntry).join("\n\n")}`;
  },
};

// ---- Strategy: ring-N ----
export function ring(n: number): ContextStrategy {
  return {
    name: `ring-${n}`,
    description: `Last ${n} sessions - recency-biased, cliff edge at ${n + 1}`,
    apply(entries) {
      if (entries.length === 0) return "";
      const recent = entries.slice(-n);
      return `# Recent Sessions (last ${n} of ${entries.length})\n\n${recent.map(renderEntry).join("\n\n")}`;
    },
  };
}

// ---- Strategy: map-only ----
export const mapOnly: ContextStrategy = {
  name: "map-only",
  description: "Topic map with latest state per project - no temporal ordering",
  apply(entries) {
    if (entries.length === 0) return "";

    // Build project → latest state map (last-write-wins)
    const projectMap = new Map<string, SessionEntry>();
    for (const entry of entries) {
      projectMap.set(entry.project, entry);
    }

    const lines: string[] = [];
    for (const [project, entry] of projectMap) {
      lines.push(
        `## ${project}`,
        `_Last active: ${entry.timestamp}_`,
        `**Current focus:** ${entry.focus}`,
        `**Last completed:** ${entry.done}`,
        ""
      );
    }

    return `# Current State by Project\n\n${lines.join("\n")}`;
  },
};

// ---- Strategy: log+map (the hybrid) ----
export function logMap(ringSize: number): ContextStrategy {
  return {
    name: `log-map-${ringSize}`,
    description: `Topic map + last ${ringSize} sessions - hybrid temporal + topical`,
    apply(entries) {
      if (entries.length === 0) return "";

      // MAP: latest state per project
      const projectMap = new Map<string, SessionEntry>();
      for (const entry of entries) {
        projectMap.set(entry.project, entry);
      }

      // LOG: last N entries chronologically
      const recent = entries.slice(-ringSize);

      const mapLines: string[] = [];
      for (const [project, entry] of projectMap) {
        mapLines.push(`- **${project}**: ${entry.focus} → ${entry.done}`);
      }

      const logLines = recent.map(
        (e) => `- ${e.timestamp} [${e.project}]: ${e.done}`
      );

      return [
        "# Current State (per project)",
        "",
        ...mapLines,
        "",
        `# Recent Activity (last ${ringSize})`,
        "",
        ...logLines,
      ].join("\n");
    },
  };
}

// ---- Strategy: cold ----
export const cold: ContextStrategy = {
  name: "cold",
  description: "No prior context - lower bound baseline",
  apply() {
    return "";
  },
};

// ---- Strategy: compacted ----
// Pre-computed recap summary
export function compacted(recapOutput: string): ContextStrategy {
  return {
    name: "recap",
    description: "Pre-computed recap output",
    apply() {
      return `# Session Recap\n\n${recapOutput}`;
    },
  };
}

// ---- Strategy: memory ----
// Caller-provided memory content.
export function memory(memoryContent: string): ContextStrategy {
  return {
    name: "memory",
    description: "Caller-provided memory content",
    apply() {
      return memoryContent;
    },
  };
}

export function defaultStrategies(opts?: {
  recapOutput?: string;
  memoryContent?: string;
}): ContextStrategy[] {
  const strategies: ContextStrategy[] = [
    full,
    ring(1),
    ring(3),
    ring(5),
    mapOnly,
    logMap(3),
    logMap(5),
    cold,
  ];
  if (opts?.recapOutput) {
    strategies.push(compacted(opts.recapOutput));
  }
  if (opts?.memoryContent) {
    strategies.push(memory(opts.memoryContent));
  }
  return strategies;
}
