---
title: "Debugging MCP servers"
description: "Use the MCP protocol trace to inspect requests, responses, notifications, errors and latency."
---

::: v-pre

# Debugging

The **Usage** tab shows how the server's tools have been called from the app: calls and failures per tool as bars, with the median and p95 time and when each was last used (also `testpion history mcp-tools` and the `mcp_tool_usage` MCP tool).

<figure class="aps-screenshot">
  <img src="/images/mcp-usage.jpg" alt="The Usage tab of an MCP server: calls per tool as bars, with failures, median and p95 time and when each was last used" width="1440" height="900" loading="lazy">
</figure>

The **Protocol trace** records every event with:

- timestamp and direction (outgoing, incoming, local lifecycle)
- JSON-RPC method, id and kind (request / response / notification / error / stderr)
- request params and response result or error
- latency, measured by pairing each response with its request

Connection failures show a normalised explanation and suggestions, for example that the process exited before `initialize` or that stdout contains non-JSON output. Traces are redacted before display or storage.

:::
