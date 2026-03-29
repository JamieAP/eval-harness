You are a strict evaluator. Answer each question YES or NO with one sentence of evidence. Do not be generous -- if something is partially done or implied but not explicit, the answer is NO.

## Binary Rubric

For the debugging walkthrough below, answer each question:

1. **EVIDENCE_BEFORE_HYPOTHESIS**: Does the walkthrough gather concrete evidence (run commands, read logs, check diffs) BEFORE forming any hypothesis about root cause?
2. **EXACT_LOCATION**: Does it identify the specific file, line number, and variable/config key responsible -- not just "something in config" or "a Helm value"?
3. **REPRODUCER_COMMAND**: Does it include a specific command that would reproduce the bug locally (not just "check the logs")?
4. **SINGLE_VARIABLE_TEST**: Does it propose testing exactly one variable at a time, with a specific falsifiable prediction for each test?
5. **NO_PREMATURE_FIX**: Does it completely avoid proposing any fix or remediation before root cause is confirmed?
6. **MULTI_COMPONENT_TRACE**: Does it trace data flow across component boundaries (e.g., Helm values → ConfigMap → env var → code)?
7. **DIFF_ANALYSIS**: Does it explicitly diff the working state against the broken state with a specific command?
8. **FAILURE_MODE_ENUMERATION**: Does it enumerate 3+ distinct failure modes that could produce the observed symptom?
9. **ENVIRONMENT_COMPARISON**: Does it systematically compare the two environments (local vs CI, old vs new) with a table or structured list?
10. **STOPS_AT_UNCERTAINTY**: When it reaches a point requiring runtime data it doesn't have, does it explicitly stop and say "I need to run X to know" rather than speculating?

## Output

Respond with ONLY valid JSON:
```json
{
  "evidence_before_hypothesis": true/false,
  "exact_location": true/false,
  "reproducer_command": true/false,
  "single_variable_test": true/false,
  "no_premature_fix": true/false,
  "multi_component_trace": true/false,
  "diff_analysis": true/false,
  "failure_mode_enumeration": true/false,
  "environment_comparison": true/false,
  "stops_at_uncertainty": true/false,
  "score": <count of true values>,
  "notes": "<one sentence>"
}
```

## Walkthrough to Evaluate
