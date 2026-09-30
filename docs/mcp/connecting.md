---
title: "Connecting to MCP servers"
description: "Configure stdio, Streamable HTTP and SSE MCP server connections."
---

::: v-pre

# Connecting

A server is edited like any request. **New ▸ MCP server** (or **+** next to *MCP servers* in the sidebar) opens a *New server* tab:

- The bar at the top holds the **transport** (stdio, Streamable HTTP, SSE or a mock) and the **command line** (`npx -y @modelcontextprotocol/server-everything`; quotes keep spaces in an argument), the **URL** or the **mock file**, then **Connect** and **Save**.
- The **Settings** tab, next to Tools, Resources, Prompts, Protocol trace and Server info, has every field: name, folder, command, arguments, working directory and environment variables (stdio) or URL and headers, and **Edit JSON**.
- **Save** (Ctrl+S) keeps it in the workspace; **Connect** saves first. The tab shows a dot while there are unsaved changes, and its right-click menu is the same as every other tab's (rename, duplicate, pin, close).

Servers are saved in `mcp-servers.json` in the workspace:

```json
{
  "servers": [
    { "id": "customer-mcp", "name": "customer-mcp", "transport": "stdio", "command": "node", "args": ["{{workspaceDir}}/../servers/mcp-server.mjs"] },
    { "id": "remote", "name": "Remote", "transport": "streamable-http", "url": "https://mcp.example.com/mcp", "headers": [{ "key": "Authorization", "value": "Bearer {{mcpToken}}" }] }
  ]
}
```

- Every field accepts variables, so tokens can come from secret environment variables.
- **Folders:** group servers in folders with the folder button above the list, the server's `⋯` / right-click menu (*Move to folder…*), the *Folder* field of the server editor, or by dragging a server onto a folder. A server's folder is its `folder` field; empty folders are kept in `library/mcp.json`.
- On Windows, use `npx.cmd` or the full path to `node.exe` for stdio servers.
- Anything the server writes to stderr is captured in the trace, which helps diagnose startup failures.
- From the terminal, `testpion mcp -- node server.js` lists a server's tools, resources and prompts.

:::
