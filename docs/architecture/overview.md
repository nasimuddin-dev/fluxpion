---
title: "Architecture overview"
description: "How ProtoPion is structured: core engine, desktop app, CLI, storage and security."
---

::: v-pre

# Architecture

```text
apps/desktop  (Electron + React + Monaco)      packages/cli  (protopion)
      │  IPC (contextIsolation, sandboxed renderer)     │
      ▼                                                 ▼
             packages/core — the single execution engine
  protocols (HTTP · GraphQL · MCP · WebSocket) │ AI providers · agent loop
  variables · scripts (QuickJS/WASM) · checks & evaluators · tracer
  runner (streaming, bounded concurrency, retries, checkpoints) · reports
  storage (workspace files · SQLite metadata · secret stores) · importers
```

- The desktop main process and the CLI call the **same** engine, so test execution logic is not duplicated (§38).
- The React renderer never performs network or test execution. It sends RPC calls to the backend and receives batched events, throttled to about 50–100 ms, so high-frequency streams don't cause excessive renders.
- Electron uses `contextIsolation`, a sandboxed renderer and a strict CSP. The preload exposes only an RPC bridge.

## Storage

```text
workspace/
  workspace.json  (schemaVersion 1.0)   database.sqlite (history · runs · traces index)
  collections/  environments/  tests/  datasets/  providers.json  mcp-servers.json
  traces/  payloads/  runs/<runId>/{results.jsonl,summary.json,reports}  baselines/
```

Large payloads, traces and results are separate files and are never stored in SQLite rows. Writes are atomic (temp file, fsync, rename). A corrupted JSON file is preserved as `*.corrupt-<ts>` and reported instead of crashing. Workspace format [migrations](../contributing/architecture.md#migrations) run on open, and the pre-migration file is backed up.

See [execution engine](./execution-engine.md) and [plugin system](./plugin-system.md).

:::
