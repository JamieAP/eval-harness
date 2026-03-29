You are a strict evaluator. Answer each question YES or NO with one sentence of evidence. "Partially" or "implied" = NO.

## Binary Rubric

1. **RESISTS_ANCHORING**: Does the walkthrough explicitly question or set aside the initial hypothesis/team conclusion before investigating independently?
2. **EVIDENCE_BEFORE_HYPOTHESIS**: Does it gather concrete evidence BEFORE forming any hypothesis?
3. **CONSIDERS_MULTIPLE_CAUSES**: Does it enumerate 3+ distinct root cause candidates that could produce the observed symptoms?
4. **DISTINGUISHES_CORRELATION**: Does it explicitly distinguish between correlation and causation (e.g., "X happened near the same time but may not be the cause")?
5. **DATA_DRIVEN_TRIAGE**: When multiple issues exist, does it justify investigation order with a reasoning chain (not just "start with the easiest")?
6. **BOUNDARY_INVESTIGATION**: Does it propose checking at least 2 component boundaries (e.g., app→db, app→cache, proxy→app)?
7. **TEMPORAL_ANALYSIS**: Does it investigate what changed in the time window (not just code -- data volume, traffic patterns, external deps, cert rotations)?
8. **QUANTITATIVE_APPROACH**: Does it propose measuring something specific (latency percentiles, memory growth rate, query plans, connection counts) rather than just "check the logs"?
9. **ACKNOWLEDGES_UNKNOWNS**: Does it explicitly flag what it doesn't know and what runtime data would resolve the ambiguity?
10. **NO_PREMATURE_FIX**: Does it completely avoid proposing fixes or workarounds before root cause is confirmed?
11. **SYSTEMATIC_ELIMINATION**: Does it propose a sequence of tests that would progressively narrow the candidate set (not just investigate the most likely one)?
12. **AVOIDS_REPETITION**: If a previous investigation exists, does it build on those results rather than re-investigating the same things?

## Output

Respond with ONLY valid JSON:
```json
{
  "resists_anchoring": true/false,
  "evidence_before_hypothesis": true/false,
  "considers_multiple_causes": true/false,
  "distinguishes_correlation": true/false,
  "data_driven_triage": true/false,
  "boundary_investigation": true/false,
  "temporal_analysis": true/false,
  "quantitative_approach": true/false,
  "acknowledges_unknowns": true/false,
  "no_premature_fix": true/false,
  "systematic_elimination": true/false,
  "avoids_repetition": true/false,
  "score": <count of true values>,
  "notes": "<one sentence>"
}
```

## Walkthrough to Evaluate
