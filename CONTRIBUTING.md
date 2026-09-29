# Contributing

Thanks for helping build TestPion.

## Setup

```bash
npm install
npm run build
npm test            # vitest: unit, integration, end-to-end
npm run typecheck
```

`node examples/servers/demo-servers.mjs` starts local REST, GraphQL, mock LLM and WebSocket servers for manual testing.

## Rules

Follow the engineering rules in the SRS (§72). The most important are:

1. Keep protocol adapters independent of each other, and keep UI state separate from execution state.
2. Never block the renderer. All execution happens in `@testpion/core` behind the backend RPC.
3. Use bounded concurrency and streaming, and never load unbounded data into memory.
4. Never expose secrets. Route every persisted or logged artefact through the `Redactor`.
5. Label AI-generated output, and don't make AI evaluation the only source of truth for deterministic requirements.
6. Storage format changes need a migration and a test.

## Definition of done

Each feature ships with its implementation, unit tests, integration tests, documentation in `docs/`, and an example. Reviewers enforce this.

## Commits and PRs

Use small, focused PRs with a clear description. Run `npm test` and `npm run typecheck` before pushing.
