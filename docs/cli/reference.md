---
title: "CLI reference"
description: "Reference for the aipstudio command-line interface."
---

::: v-pre

# CLI reference

```text
aipstudio test [paths...]      Run test files, directories, globs or a *.suite.yaml
aipstudio run --suite <name>   Run tests/<name>.suite.yaml from a workspace
aipstudio load <url>           Safeguarded load test
aipstudio import <file> -w     Import OpenAPI/Swagger, Postman, HAR or collections
aipstudio workspace list|create|export
aipstudio mcp [--url|--sse] [-- command...]   Inspect an MCP server
aipstudio report <results.jsonl>              Re-generate reports
```

## `test` / `run` options

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: nearest `workspace.json`). |
| `-e, --environment` | Environment name. |
| `-c, --concurrency` | Parallel workers. |
| `--retries`, `--timeout` | Retries per failing test; per-test timeout in ms. |
| `-r, --reporter` | `console junit json html markdown` |
| `-o, --out` | Output directory (default `runs/<runId>`). |
| `-t, --tags`, `-g, --grep` | Filter tests. |
| `--bail` | Stop after the first failure. |
| `--resume <runId>` | Continue an interrupted run. |
| `--var k=v` | Runtime variable (repeatable). |
| `--baseline`, `--save-baseline`, `--fail-on-regression` | Regression testing. |
| `--trace all\|failures\|none` | Trace persistence. |
| `--log-level` | Enable debug logging; secrets stay redacted. |

Exit codes: `0` success, `1` test failure, `2` configuration error, `3` execution error.

:::
