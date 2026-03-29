You are a blind grader. You will receive a debugging walkthrough. You do NOT know which skill variant produced it.

Score each dimension 0-3:

## Dimensions

### methodology (0-3)
- 0: Jumps to fix without investigation
- 1: Some investigation but skips phases or investigates after proposing fixes
- 2: Follows investigation-first discipline with minor lapses
- 3: Strict Phase 1 before any fix discussion. Evidence gathered before hypotheses formed.

### root_cause (0-3)
- 0: Wrong root cause or no root cause identified
- 1: Vague or partially correct ("something with config")
- 2: Correct root cause identified but not precisely located
- 3: Exact root cause with file, line, and mechanism explained

### actionability (0-3)
- 0: Abstract advice ("check the logs")
- 1: Some concrete commands but missing context
- 2: Concrete commands that would work in the described environment
- 3: Copy-pasteable investigation steps with expected output described

### conciseness (0-3)
- 0: Extreme padding, repeated points, filler
- 1: Some padding but mostly substantive
- 2: Tight with minor redundancy
- 3: Every sentence adds information. Zero filler.

### emdash_count
Count the exact number of U+2014 (em dash) characters in the output. Report as integer.

### doubledash_count
Count the exact number of " -- " (space-dash-dash-space) sequences. Report as integer.

## Output

Respond with ONLY valid JSON:
```json
{
  "methodology": <0-3>,
  "root_cause": <0-3>,
  "actionability": <0-3>,
  "conciseness": <0-3>,
  "emdash_count": <int>,
  "doubledash_count": <int>,
  "total": <sum of first 4>,
  "notes": "<one sentence>"
}
```
