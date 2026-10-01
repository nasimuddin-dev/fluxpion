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

Each feature ships with its implementation, unit tests, integration tests, documentation in `docs/`, and an example. A change to the desktop UI also adds or updates steps in the UI regression suite. Reviewers enforce this.

## UI regression suite

`apps/desktop/e2e` drives the real app: each plan in `e2e/plans` starts TestPion with a fresh copy of the examples workspace, runs its steps in the window, screenshots each one and checks the result.

```bash
npm run build -w @testpion/desktop
npm run e2e -w @testpion/desktop                       # every plan
npm run e2e -w @testpion/desktop -- --only keyboard    # one plan
```

It runs before every release and against the installed app after one. How to read the report and write a plan: `.claude/skills/ui-regression/SKILL.md`.

## Commits and PRs

Use small, focused PRs with a clear description. Run `npm test` and `npm run typecheck` before pushing.
