---
title: "Connecting to MCP servers"
description: "Configure stdio, Streamable HTTP and SSE MCP server connections."
---

::: v-pre

# Connecting

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
- On Windows, use `npx.cmd` or the full path to `node.exe` for stdio servers.
- Anything the server writes to stderr is captured in the trace, which helps diagnose startup failures.
- From the terminal, `protopion mcp -- node server.js` lists a server's tools, resources and prompts.

:::
