---
title: "Use TestPion from AI agents"
description: "Serve a workspace to Claude, IDE assistants and other AI agents over MCP with testpion mcp-server, and point them to llms.txt."
---

::: v-pre

# Use TestPion from AI agents

`testpion mcp-server` makes a workspace available to AI agents as [Model Context Protocol](https://modelcontextprotocol.io) tools. An agent such as Claude Code, Claude Desktop or an IDE assistant can then find your requests, read their documentation, send them and run collections, with your environments and auth, without seeing your secrets.

## Register the server

The server speaks MCP over stdio. Point your agent at the `testpion` CLI with the workspace to serve:

```json
{
  "mcpServers": {
    "testpion": {
      "command": "testpion",
      "args": ["mcp-server", "-w", "/path/to/my-workspace"]
    }
  }
}
```

For Claude Code: `claude mcp add testpion -- testpion mcp-server -w /path/to/my-workspace`.

| Option | Description |
|---|---|
| `-w, --workspace` | Workspace name or directory (default: the nearest `workspace.json` above the current directory). |
| `--read-only` | Only the browsing tools. The agent can read collections and docs but not send requests. |
| `--allow-production` | Allow sending to environments marked as **production**. They are refused by default. |

## Tools

| Tool | What it does |
|---|---|
| `list_collections` | Collections with their request and example counts. |
| `list_requests` | The requests of a collection: id, name, method, URL (with `{{variables}}`), folder. |
| `get_request` | One saved request: headers, body, auth type, scripts, assertions, documentation, example names. |
| `list_environments` | Environments and their variable **names** (values are not returned). |
| `collection_docs` | The collection's [Markdown documentation](/api-testing/collections#documentation). |
| `send_request` | Send a saved request (its scripts and assertions run too) or an ad-hoc request: `method` + `url` (+ `headers`, `body`), or a copied cURL / fetch / PowerShell `snippet`. `{{variables}}` resolve from the chosen environment. Returns status, headers, body (up to 20,000 characters) and timing; for a saved request also the scripts' `console.log` output (`scriptLogs`) and the [`pm.visualizer`](/api-testing/rest#visualize-responses-pm-visualizer) rendering (`visualization.html`). |
| `run_collection` | Run a collection or one folder like the [Collection Runner](/api-testing/collections#collection-runner) and return totals and per-request results with failure messages, script logs and visualizations. |
| `parse_request_snippet` | Turn a request copied from browser devtools or docs (cURL for bash or cmd, fetch, fetch (Node.js), PowerShell `Invoke-WebRequest` / `Invoke-RestMethod`) into a structured request: method, URL, params, headers, cookies, body and auth. Nothing is sent or saved. Tokens, keys, cookies and passwords come back as `{{variables}}`, listed in `placeholders`. |
| `save_request` | Save a request into a collection and folder path (`"Auth / Tokens"`, created as needed; `create: true` makes a new collection). Give a `snippet` or `method` + `url` (+ `headers`, `body`). Secret values are **not** written to the workspace: they become `{{variables}}`, and the result's `placeholders` lists them so the user can add them as secret environment variables. |
| `request_history` | Earlier responses of a saved request (sent in the app), newest first: id, time, status, duration, size. |
| `compare_responses` | Compare two responses by history id: status, timing, header changes and a field-by-field JSON body diff (`$.path` added / removed / changed). Sensitive values are masked. |
| `reorder_environments` | Set the order of environments in the environment picker (names or ids, first to last). |

`save_request` and `reorder_environments` change workspace files, and `--read-only` hides them together with the tools that send requests.

## What agents can and can't see

- Output uses the workspace's redaction rules. Sensitive headers, JSON fields and known secret values are masked, and environment values are never listed.
- Secrets resolve inside TestPion when a request is sent. The agent sees `{{accessToken}}`, never the token. In the CLI, secrets come from `TESTPION_SECRET_*` environment variables (see [Secrets](/security/secrets)).
- Requests go only where your collections and environments point. Production environments need `--allow-production`, and `--read-only` removes sending altogether.

## llms.txt

The documentation site publishes [`/llms.txt`](https://nasimuddin-dev.github.io/testpion/llms.txt), a short, link-rich summary of TestPion for language models. Give it to an assistant that should learn how TestPion works.

:::
