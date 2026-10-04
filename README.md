# Evaluation harness

A Bun and TypeScript CLI for comparing prompt variants, running model trials, and grading outputs.

The bundled `demo-cache` context case and two debugging scenarios are synthetic. Their projects, dates, paths, events, prompts, expected facts, recaps, and memory are invented examples.

## Setup

```sh
bun install --ignore-scripts
bun test
bun run src/cli.ts --help
```

Regenerate the public context variants from the synthetic input:

```sh
bun run context-eval/corpus-builder.ts --input context-eval/synthetic-demo.json --public --output .
```

`context-eval/strategies.ts` implements full history, recent rings, project maps, log/map hybrids, cold baseline, supplied recap, and supplied memory strategies. Generated files use the case names expected by `context-eval/run-grade.ts`. The cold variant receives no prior event facts.

Strategies receive different amounts of context. Their example scores do not establish comparative model or prompt quality.

## Run a trial

Set `ANTHROPIC_API_KEY`, then choose a variant and a matching scenario:

```sh
bun run src/cli.ts run ctx-demo-cache-full ctx-demo-cache 1
```

For the synthetic debugging scenarios:

```sh
bun run src/cli.ts eval --variants debug-baseline,debug-concise --scenarios pod-crash,flaky-ci -n 1
```

Grade context-case results with:

```sh
bun run context-eval/run-grade.ts
```

The CLI evaluates the cross product of variants and scenarios. Select matching case names to avoid unrelated combinations.

### Authentication and provider calls

- Trials and Anthropic grading use provider API keys.
- OpenRouter judging requires `OPENROUTER_API_KEY`.
- The optional Codex judge runs the installed `codex` CLI with its separately configured authentication.

Provider-key helpers do not use a local token broker or secret-helper command. Choose available models through the CLI options; model defaults and panel availability can change.

Trials and grading send selected prompts, context, ground truth, and outputs to the chosen model provider. Review custom material before running them. Provider charges may apply.

Results and grading data are written to the ignored `results/` directory. Inspect them before sharing.

## Use your own corpus

The exporter reads only the JSON file passed to `--input`. It does not automatically read session databases, home-directory memory, or local history.

Use `context-eval/synthetic-demo.json` as the schema example. Required fields are `id`, `synthetic`, `entries`, `task`, and `groundTruth`; `recap` and `memory` are optional. Entries are sorted chronologically before rendering.

```sh
# Default output is the harness's ignored private-corpora/ directory:
bun run context-eval/corpus-builder.ts --input /path/to/reviewed-corpus.json
# A custom private destination must stay within that directory:
bun run context-eval/corpus-builder.ts --input /path/to/reviewed-corpus.json --output private-corpora/local-case
```

The default output stays anchored to the harness when the caller changes working directory. Custom relative output paths are resolved from the caller's working directory.

Any destination outside the harness's `private-corpora/` directory requires `--public --output DIRECTORY` and `synthetic: true`. This includes `--output .`; a custom path cannot bypass the check for private input.

Before creating directories or writing files, private exports check existing output ancestors and generated destinations. They reject symlinks, nonregular file destinations, and files with hard links. These checks do not prevent another process from changing paths concurrently. Git ignore rules do not encrypt files or prevent a forced add.

`synthetic: true` is a declaration, not proof of anonymisation. Review every input and generated file, and use invented facts for shared examples. Keep private inputs, `.env` files, provider keys, raw outputs, and exports out of Git.

## License

Project code and bundled synthetic examples are licensed under [MIT](LICENSE).

Third-party dependencies retain their own licenses. This license does not grant rights to private or third-party data supplied to the harness.
