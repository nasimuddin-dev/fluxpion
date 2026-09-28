---
title: "Use FluxPion from AI agents"
description: "Serve a workspace to Claude, IDE assistants and other AI agents over MCP with fluxpion mcp-server, and point them to llms.txt."
---

::: v-pre

# Use FluxPion from AI agents

`fluxpion mcp-server` makes a workspace available to AI agents as [Model Context Protocol](https://modelcontextprotocol.io) tools. An agent such as Claude Code, Claude Desktop or an IDE assistant can then find your requests, read their documentation, send them and run collections, with your environments and auth, without seeing your secrets.

## Register the server

The server speaks MCP over stdio. Point your agent at the `fluxpion` CLI with the workspace to serve:

```json
{
  "mcpServers": {
    "fluxpion": {
      "command": "fluxpion",
      "args": ["mcp-server", "-w", "/path/to/my-workspace"]
    }
  }
}
```

For Claude Code: `claude mcp add fluxpion -- fluxpion mcp-server -w /path/to/my-workspace`.

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
| `send_request` | Send a saved request (its scripts and assertions run too) or an ad-hoc `method` + `url` (+ `headers`, `body`). `{{variables}}` resolve from the chosen environment. Returns status, headers, body (up to 20,000 characters) and timing. |
| `run_collection` | Run a collection or one folder like the [Collection Runner](/api-testing/collections#collection-runner) and return totals and per-request results with failure messages. |

## What agents can and can't see

- Output uses the workspace's redaction rules. Sensitive headers, JSON fields and known secret values are masked, and environment values are never listed.
- Secrets resolve inside FluxPion when a request is sent. The agent sees `{{accessToken}}`, never the token. In the CLI, secrets come from `FLUXPION_SECRET_*` environment variables (see [Secrets](/security/secrets)).
- Requests go only where your collections and environments point. Production environments need `--allow-production`, and `--read-only` removes sending altogether.

## llms.txt

The documentation site publishes [`/llms.txt`](https://nasimuddin-dev.github.io/fluxpion/llms.txt), a short, link-rich summary of FluxPion for language models. Give it to an assistant that should learn how FluxPion works.

:::
