---
title: "CLI reference"
description: "Reference for the testpion command-line interface."
---

::: v-pre

# CLI reference

```text
testpion test [paths...]      Run test files, directories, globs or a *.suite.yaml
testpion run --suite <name>   Run tests/<name>.suite.yaml from a workspace
testpion run-collection <collection>   Run a collection like Postman's Collection Runner / Newman
testpion mock-graphql --schema <file>   Fake data for any query against a GraphQL schema (see GraphQL mock server)
testpion mock <collection>    Serve a collection's saved examples on localhost
testpion mock-mcp <file>      Serve an MCP mock (stdio, or --http) for AI agents and MCP clients
testpion openapi-diff <old> <new>   List breaking changes between two OpenAPI versions (--fail-on-breaking for CI)
testpion docs <collection>    Write Markdown (or --html) documentation for a collection
testpion export <collection>  Export a collection as Postman v2.1 (or TestPion JSON)
testpion export-environment <name>   Export an environment in Postman's format
testpion mcp-server           Serve a workspace to AI agents over MCP (stdio)
testpion load <url>           Safeguarded load test
testpion import <file|-> -w   Import OpenAPI/Swagger, Postman, HAR, collections, or a copied cURL / fetch / PowerShell request
testpion env list|order|diff -w  List environments; set their order; compare two
testpion monitor list|add|remove|run|results|start -w  Collections on a schedule (monitors)
testpion ci <github|gitlab|azure|jenkins> -w  A CI pipeline file for a suite, collection or tests
testpion trash list|restore|empty -w  Recently deleted collections and environments (30 days)
testpion history list|stats|diff -w  Response history of saved requests; response times; compare two responses
testpion workspace list|create|rename|delete|export   Manage workspaces (see Workspaces)
testpion mcp [--url|--sse] [-- command...]   Inspect an MCP server
testpion ws <url> [-m msg] [-e event=json]    Talk to a WebSocket or Socket.IO server and print the replies
testpion grpc <target> [method] [-p protos]   Call a gRPC method, or list the methods (.proto files or server reflection)
testpion report <results.jsonl>              Re-generate reports
```

## `test` / `run` options

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: nearest `workspace.json`). |
| `-e, --environment` | Environment name. |
| `-c, --concurrency` | Parallel workers. |
| `--retries`, `--timeout` | Retries per failing test; per-test timeout in ms. |
| `-r, --reporter` | `console junit json html markdown` |
| `-o, --out` | Output directory (default `runs/<runId>` in the workspace, or `./testpion-results/<runId>` outside one). |
| `-t, --tags`, `-g, --grep` | Filter tests. |
| `--bail` | Stop after the first failure. |
| `--resume <runId>` | Continue an interrupted run. |
| `--var k=v` | Runtime variable (repeatable). |
| `--baseline`, `--save-baseline`, `--fail-on-regression` | Regression testing. |
| `--trace all\|failures\|none` | Trace persistence. |
| `--log-level` | Enable debug logging; secrets stay redacted. |

## `run-collection`

Runs a collection one request at a time, in order, with its `pm.*` scripts, like Postman's Collection Runner or Newman. `<collection>` is a collection name or id in the workspace, a collection file (TestPion or Postman v2.1 JSON), or an http(s) link to one (e.g. a collection published in a repository). A collection file runs in a temporary workspace, so your own workspace isn't changed.

```bash
# a collection in the workspace
testpion run-collection "Veterinary API" -e Development

# Newman-style: Postman collection + environment files, one iteration per CSV row
testpion run-collection api.postman_collection.json -e staging.postman_environment.json -d users.csv -r console junit
```

| Option | Description |
|---|---|
| `-e, --environment` | Environment name, or a Postman environment file. |
| `-d, --iteration-data` | CSV or JSON data file: one row per iteration (`pm.iterationData`, `{{column}}`). |
| `-n, --iteration-count` | Number of iterations (default: the number of data rows, or 1). |
| `--delay-request <ms>` | Pause between requests. |
| `--folder <name...>` | Only run these folders or requests, by name or id (repeatable). |
| `--bail`, `--timeout` | Stop after the first failure; per-request timeout in ms. |
| `--cookie-jar <file>` | Start with the cookies in this JSON file (TestPion format or a Newman cookie jar). |
| `--export-cookie-jar <file>` | Write the run's cookie jar to this JSON file afterwards (plain text: keep it out of git). |
| `-g, --globals <file>` | A Postman globals file. |
| `--env-var <key=value>`, `--global-var <key=value>` | Set an environment or global variable (repeatable); overrides the files. |
| `--export-environment <file>`, `--export-globals <file>` | Write the environment / globals after the run, including values scripts set, as Postman files. Secret values are left empty. |
| `-k, --insecure` | Don't verify TLS certificates (development servers only). |
| `--suppress-exit-code` | Exit `0` even when tests fail (configuration errors still exit `2`). |
| `--reporter-junit-export <file>` | Also write the JUnit report to this file. |
| `-w`, `-r`, `-o`, `--var`, `--trace`, `--baseline` … | Same as `test`. |

**Coming from Newman?** Most command lines work after replacing `newman run` with `testpion run-collection`: `-e`, `-g`, `-d`, `-n`, `--folder`, `--env-var`, `--global-var`, `--delay-request`, `--timeout-request`, `--bail`, `-k`, `--export-environment`, `--export-globals`, `--suppress-exit-code`, `--reporters` and `--reporter-junit-export` mean the same.

```bash
# newman run api.json -e staging.json -g globals.json --env-var token=$TOKEN --reporters cli,junit --reporter-junit-export out.xml
testpion run-collection api.json -e staging.json -g globals.json --env-var token=$TOKEN --reporters console junit --reporter-junit-export out.xml
```

Variables set by scripts carry over to later requests and iterations, and so do cookies (see [Cookies](/api-testing/cookies)). `pm.execution.setNextRequest()` changes the order. Outside a workspace, reports go to `./testpion-results/<runId>` unless you pass `-o`.

Exit codes: `0` success, `1` test failure, `2` configuration error, `3` execution error.

## `openapi-diff`

Compares two versions of an OpenAPI 3 / Swagger 2 document (files or http(s) links) and lists breaking and other changes. See [Catch breaking API changes](/test-runner/ci-cd#catch-breaking-api-changes).

| Option | Description |
|---|---|
| `--fail-on-breaking` | Exit `1` when there are breaking changes. |
| `--breaking-only` | Leave out the non-breaking changes. |
| `--json` | Print `{ breaking, nonBreaking, operations }` as JSON. |

## `mock`

Serves the [saved examples](/api-testing/collections#examples) of a collection on `127.0.0.1` until you press Ctrl+C. See [Mock servers](/api-testing/mock-servers) for how requests are matched to examples.

```bash
testpion mock "Veterinary API" -p 4545
testpion mock api.postman_collection.json      # Postman saved responses work too
```

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: nearest `workspace.json`). |
| `-p, --port <port>` | Port to listen on (default: any free port; the URL is printed). |
| `--delay <ms>` | Delay every response. |
| `-q, --quiet` | Don't log requests. |

## `mock-mcp`

Serves an [MCP mock](/mcp/mocking) (`*.mcp-mock.yaml`: tools with canned responses, resources, prompts). By default it speaks MCP over stdio, so AI agents can start it as a command; logs go to stderr.

```bash
testpion mock-mcp mocks/customer.mcp-mock.yaml
testpion mock-mcp mocks/customer.mcp-mock.yaml --http -p 3333   # Streamable HTTP on 127.0.0.1
```

| Option | Description |
|---|---|
| `--http` | Serve over Streamable HTTP on `127.0.0.1` instead of stdio (the URL is printed). |
| `-p, --port <port>` | Port for `--http` (default: any free port). |

## `ws`

Connects to a [WebSocket or Socket.IO](/api-testing/websocket) server, sends messages (WebSocket) or emits events (Socket.IO) in order, prints everything the server sends while it listens, then closes. The exit code is 3 when it can't connect (the reason is printed).

```bash
testpion ws ws://127.0.0.1:4013 -m '{"type":"ping"}' -m second
testpion ws http://127.0.0.1:4015/chat -e 'say={"text":"hi"}' --ack --json
```

| Option | Description |
|---|---|
| `-m, --message <text...>` | WebSocket messages, in order. |
| `-e, --emit <event=json...>` | Socket.IO events with their argument (a JSON list gives several arguments). Implies Socket.IO. |
| `--ack` | Socket.IO: wait for acknowledgements. |
| `--socketio` | Use Socket.IO (the default for `http(s)://` URLs). |
| `-H, --header <key:value...>` | Handshake headers. |
| `--auth <json>` | Socket.IO handshake auth payload. |
| `-w, --wait <ms>` | How long to listen after sending (default 1500). |
| `--json` | Print the result as JSON, for scripts and AI agents. |

## `grpc`

Calls a [gRPC](/api-testing/grpc) method described by `.proto` files (or, without `-p`, by the server through server reflection), or lists the methods (with example requests) when no method is given. The exit code is 0 for status `OK` and 1 otherwise.

```bash
testpion grpc localhost:4014 -p protos/vet/v1/pets.proto                  # list methods
testpion grpc localhost:4014 vet.v1.PetService/GetPet -p protos/vet/v1/pets.proto -d '{"id": "1"}'
testpion grpc grpcs://api.example.com vet.v1.PetService/ListPets -p pets.proto -H "authorization:Bearer $TOKEN" --json
```

| Option | Description |
|---|---|
| `-p, --proto <files...>` | The `.proto` files, including the ones they import. Leave out to use server reflection. |
| `-d, --data <json>` | The request message as JSON (a JSON list for client streaming), or `@file.json`. Default `{}`. |
| `-H, --metadata <key:value...>` | Metadata entries. |
| `--tls` | Use TLS (also on with a `grpcs://` address). |
| `--timeout <ms>` | Deadline (default 30000). |
| `--json` | Print the result as JSON, for scripts and AI agents. |

## `docs`

Writes the [documentation](/api-testing/collections#documentation) of a collection as Markdown: the collection description, a table of contents, then every folder and request with its description, URL, auth, parameters, headers, body and saved examples. Sensitive values are masked.

```bash
testpion docs "Veterinary API" -o API.md
testpion docs "Veterinary API" --html -o api.html   # one self-contained page to publish
testpion docs api.postman_collection.json > API.md
```

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: nearest `workspace.json`). |
| `-o, --out <file>` | Write to a file instead of standard output. |
| `--no-examples` | Leave out saved examples. |

## `export` and `export-environment`

Convert a collection to a Postman v2.1 collection, or write an environment in Postman's environment format. See [Export](/api-testing/collections#export) for what the Postman format can hold.

```bash
testpion export "Veterinary API" -o vet.postman_collection.json
testpion export my.collection.json -f postman > out.json    # convert a file
testpion export-environment Staging -o staging.postman_environment.json
```

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: nearest `workspace.json`). |
| `-f, --format` | `postman` (default) or `testpion` (`export` only). |
| `-o, --out <file>` | Write to a file instead of standard output. |

Parts that Postman can't represent are listed on standard error as `not exported: …`. Secret environment values are never written.

## `import`

```bash
testpion import openapi.yaml -w my-workspace
# a request copied from browser devtools (cURL for bash or cmd, fetch, PowerShell), from a file or stdin
testpion import copied-request.txt -w my-workspace --collection "Checkout API" --folder "Cart" --json
pbpaste | testpion import - -w my-workspace
```

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (required). |
| `--collection <name>` | For a copied request: the collection to add it to, created if needed (default **Imported**). |
| `--folder <path>` | For a copied request: folder path inside the collection, such as `"Auth / Tokens"`. |
| `--name <name>` | For a copied request: its name (default: the method and path, e.g. `POST /v1/owners`). |
| `--no-contract-checks` | For an OpenAPI / Swagger document: don't add `openapi` contract checks to the imported requests (the document is still kept in `specs/`). |
| `--json` | Print the result as JSON, for scripts and AI agents (includes `specPath` and `contractChecks` for OpenAPI imports). |

Secrets in a copied request (the `Authorization` header and other sensitive headers, auth credentials, cookies, and sensitive query or body fields) are not written to the workspace. They are replaced by `{{variables}}`, and the output lists them (`placeholders` with `--json`) so you can add them as secret environment variables.

## `scripts convert`

```bash
testpion scripts convert --to tp -w my-workspace --dry-run --json   # what would change
testpion scripts convert --to tp -w my-workspace --collection "Checkout API"
```

Rewrites collection, folder and request scripts from Postman's `pm.*` to TestPion's `tp.*` (or back with `--to pm`). Both names always run in TestPion; only code changes, not strings or comments, and scripts that declare their own `tp` are skipped and listed.

## `history`

```bash
testpion history list -w my-workspace --request "List patients" --json   # newest first
testpion history stats -w my-workspace --request "List patients" --json  # median, p95, slowest, failed
testpion history diff h-abc h-def -w my-workspace --json                  # older id first
```

`history list` shows recent responses of requests sent in the app (`--collection`, `--request`, `-n/--limit`). `history stats` summarises the response times of a request's recent responses (`-n/--limit`, default 50): count, failed (no status or 400+), fastest, mean, median, p95 and slowest. `history diff` compares two of them: the status, timing, header changes (volatile ones such as `date` are flagged) and a field-by-field JSON body diff, or a line diff for text. Values of sensitive fields and headers are masked.

## `monitor`

```bash
testpion monitor add "API health" --collection "My API" --folder Smoke --every 15m -e Staging -w my-workspace
testpion monitor run --due -w my-workspace      # for cron; exit 1 if a run failed
testpion monitor start -w my-workspace          # keep running them until Ctrl+C
```

`list`, `results` and `add` take `--json`. See [Monitors](/test-runner/monitors).

## `ci`

```bash
testpion ci github -w . --suite regression -e Staging -o .github/workflows/testpion.yml
testpion ci gitlab -w api-tests --collection "My API" --folder Smoke --workspace-dir api-tests
testpion ci jenkins -w . --tests rest graphql --json
```

Writes a pipeline for GitHub Actions, GitLab CI, Azure Pipelines or Jenkins that installs the CLI (pinned to this version), runs the suite, collection or tests, publishes `junit.xml` and keeps the reports. Without `-o` it prints the file; the CI secrets to create are listed on stderr (and under `secrets` with `--json`). See [CI/CD](/test-runner/ci-cd#generate-a-pipeline).

## `env`

```bash
testpion env list -w my-workspace --json          # environments in display order, variable names only
testpion env diff Staging Production -w my-workspace --values   # what differs (exit 1 if anything does)
testpion env diff Staging Production --request "List patients" -w my-workspace   # send it to both, diff the responses
testpion env order Development Staging Production -w my-workspace
```

`env order` sets the order of the environment picker. Environments you don't name keep their order after the named ones. Both commands take `--json`.

## `mcp-server`

Serves a workspace to AI agents over MCP on stdio: `list_collections`, `list_requests`, `get_request`, `list_environments`, `collection_docs`, `send_request`, `grpc_call`, `realtime_exchange` and `run_collection`. See [Use TestPion from AI agents](/ai-testing/mcp-server).

```bash
testpion mcp-server -w my-workspace
testpion mcp-server --read-only
```

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: nearest `workspace.json`). |
| `--read-only` | Only the browsing tools; no requests are sent. |
| `--allow-production` | Allow sending to environments marked as production. |
| `--block-private-networks` | Refuse requests to localhost, private networks and cloud metadata addresses, and don't start local (stdio) MCP servers. For shared or hosted use; see [Network policy](/security/privacy#network-policy-shared-and-hosted-servers). |
| `--allow-host <host...>` | With `--block-private-networks`: hosts that stay reachable. |

:::
