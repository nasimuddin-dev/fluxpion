---
title: "Test runner"
description: "Run test suites in parallel with bounded concurrency, retries, timeouts, dependencies, setup/teardown, cancellation and resumable runs."
---

::: v-pre

# Test runner

Tests are YAML or JSON files under `tests/`, of type `http`, `graphql`, `grpc`, `websocket` (or `socketio`, `mqtt`), `mcp`, `llm`, `rag` or `agent`. A file can hold one test, a `tests:` list (with `defaults:`), or a dataset template. You don't have to write them by hand: **Save as test** in the REST tab menu and **Test** in the GraphQL, gRPC and WebSocket views save the current request as a test file (the MCP view has **Save as test** too). Suites are `*.suite.yaml` files:

```yaml
name: Regression
tests: [rest, graphql, mcp, ai]
setup: [rest/auth.yaml]
teardown: [rest/cleanup.yaml]
concurrency: 8
retries: 1
environment: Staging
```

## Execution model

- Tests stream from disk and are never loaded all at once. At most 2× the concurrency is pulled ahead of the workers (**backpressure**).
- **Bounded concurrency:** a semaphore-based worker pool.
- **Retries:** exponential backoff; the attempt count is recorded.
- **Timeout** per test and **cancellation** (Ctrl+C in the CLI, *Cancel* in the UI).
- **Dependencies:** `dependsOn: [id]` waits for other tests. If a dependency does not pass, the dependent test is skipped with a reason.
- **Extraction:** `extract: { token: $.access_token }` sets runtime variables for later tests.
- Results are appended to `results.jsonl` as they finish, which also acts as a checkpoint: `--resume <runId>` continues an interrupted run.
- Only aggregates (counts, percentiles, tokens, cost, mean scores) are kept in memory, so runs with a million tests are fine.

## Reports

Every run writes `junit.xml`, `report.json`, `report.html` and `report.md`, containing totals, duration, errors, latency percentiles, AI metrics, tokens, cost estimates, and per-test AI details (prompt, model, input, output, evaluator, score, explanation). The HTML report also has a pass/fail bar, a response-time histogram, the slowest tests and the checks that failed most (plain SVG and HTML, so it works as a CI artifact). See [assertions](./assertions.md), [datasets](./datasets.md) and [CI/CD](./ci-cd.md).

In the app, a finished run has a **Charts** tab next to its results: how many tests fell in each response-time range (passed and failed), results per test type, the five slowest tests (click one to find it in the results) and the checks that failed most.

:::
