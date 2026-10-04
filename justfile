# Local commands; running evaluations sends selected fixtures to a provider.
default:
    bun run src/cli.ts --help

test:
    bun test

fixtures:
    bun run context-eval/corpus-builder.ts --input context-eval/synthetic-demo.json --public --output .

run-demo:
    bun run src/cli.ts run ctx-demo-cache-full ctx-demo-cache 1

grade:
    bun run context-eval/run-grade.ts
