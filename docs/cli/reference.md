---
title: "CLI reference"
description: "Reference for the protolens command-line interface."
---

::: v-pre

# CLI reference

```text
protolens test [paths...]      Run test files, directories, globs or a *.suite.yaml
protolens run --suite <name>   Run tests/<name>.suite.yaml from a workspace
protolens run-collection <collection>   Run a collection like Postman's Collection Runner / Newman
protolens load <url>           Safeguarded load test
protolens import <file> -w     Import OpenAPI/Swagger, Postman, HAR or collections
protolens workspace list|create|export
protolens mcp [--url|--sse] [-- command...]   Inspect an MCP server
protolens report <results.jsonl>              Re-generate reports
```

## `test` / `run` options

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: nearest `workspace.json`). |
| `-e, --environment` | Environment name. |
| `-c, --concurrency` | Parallel workers. |
| `--retries`, `--timeout` | Retries per failing test; per-test timeout in ms. |
| `-r, --reporter` | `console junit json html markdown` |
| `-o, --out` | Output directory (default `runs/<runId>` in the workspace, or `./protolens-results/<runId>` outside one). |
| `-t, --tags`, `-g, --grep` | Filter tests. |
| `--bail` | Stop after the first failure. |
| `--resume <runId>` | Continue an interrupted run. |
| `--var k=v` | Runtime variable (repeatable). |
| `--baseline`, `--save-baseline`, `--fail-on-regression` | Regression testing. |
| `--trace all\|failures\|none` | Trace persistence. |
| `--log-level` | Enable debug logging; secrets stay redacted. |

## `run-collection`

Runs a collection one request at a time, in order, with its `pm.*` scripts, like Postman's Collection Runner or Newman. `<collection>` is a collection name or id in the workspace, or a collection file (Protolens or Postman v2.1 JSON). A collection file runs in a temporary workspace, so your own workspace isn't changed.

```bash
# a collection in the workspace
protolens run-collection "Veterinary API" -e Development

# Newman-style: Postman collection + environment files, one iteration per CSV row
protolens run-collection api.postman_collection.json -e staging.postman_environment.json -d users.csv -r console junit
```

| Option | Description |
|---|---|
| `-e, --environment` | Environment name, or a Postman environment file. |
| `-d, --iteration-data` | CSV or JSON data file: one row per iteration (`pm.iterationData`, `{{column}}`). |
| `-n, --iteration-count` | Number of iterations (default: the number of data rows, or 1). |
| `--delay-request <ms>` | Pause between requests. |
| `--folder <name...>` | Only run these folders or requests, by name or id (repeatable). |
| `--bail`, `--timeout` | Stop after the first failure; per-request timeout in ms. |
| `-w`, `-r`, `-o`, `--var`, `--trace`, `--baseline` … | Same as `test`. |

Variables set by scripts carry over to later requests and iterations. `pm.execution.setNextRequest()` changes the order. Outside a workspace, reports go to `./protolens-results/<runId>` unless you pass `-o`.

Exit codes: `0` success, `1` test failure, `2` configuration error, `3` execution error.

:::
