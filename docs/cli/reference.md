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
protolens mock <collection>    Serve a collection's saved examples on localhost
protolens docs <collection>    Write Markdown documentation for a collection
protolens export <collection>  Export a collection as Postman v2.1 (or Protolens JSON)
protolens export-environment <name>   Export an environment in Postman's format
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
| `--cookie-jar <file>` | Start with the cookies in this JSON file (Protolens format or a Newman cookie jar). |
| `--export-cookie-jar <file>` | Write the run's cookie jar to this JSON file afterwards (plain text: keep it out of git). |
| `-w`, `-r`, `-o`, `--var`, `--trace`, `--baseline` … | Same as `test`. |

Variables set by scripts carry over to later requests and iterations, and so do cookies (see [Cookies](/api-testing/cookies)). `pm.execution.setNextRequest()` changes the order. Outside a workspace, reports go to `./protolens-results/<runId>` unless you pass `-o`.

Exit codes: `0` success, `1` test failure, `2` configuration error, `3` execution error.

## `mock`

Serves the [saved examples](/api-testing/collections#examples) of a collection on `127.0.0.1` until you press Ctrl+C. See [Mock servers](/api-testing/mock-servers) for how requests are matched to examples.

```bash
protolens mock "Veterinary API" -p 4545
protolens mock api.postman_collection.json      # Postman saved responses work too
```

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: nearest `workspace.json`). |
| `-p, --port <port>` | Port to listen on (default: any free port; the URL is printed). |
| `--delay <ms>` | Delay every response. |
| `-q, --quiet` | Don't log requests. |

## `docs`

Writes the [documentation](/api-testing/collections#documentation) of a collection as Markdown: the collection description, a table of contents, then every folder and request with its description, URL, auth, parameters, headers, body and saved examples. Sensitive values are masked.

```bash
protolens docs "Veterinary API" -o API.md
protolens docs api.postman_collection.json > API.md
```

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: nearest `workspace.json`). |
| `-o, --out <file>` | Write to a file instead of standard output. |
| `--no-examples` | Leave out saved examples. |

## `export` and `export-environment`

Convert a collection to a Postman v2.1 collection, or write an environment in Postman's environment format. See [Export](/api-testing/collections#export) for what the Postman format can hold.

```bash
protolens export "Veterinary API" -o vet.postman_collection.json
protolens export my.collection.json -f postman > out.json    # convert a file
protolens export-environment Staging -o staging.postman_environment.json
```

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: nearest `workspace.json`). |
| `-f, --format` | `postman` (default) or `protolens` (`export` only). |
| `-o, --out <file>` | Write to a file instead of standard output. |

Parts that Postman can't represent are listed on standard error as `not exported: …`. Secret environment values are never written.

:::
