---
title: "Debugging MCP servers"
description: "Use the MCP protocol trace to inspect requests, responses, notifications, errors and latency."
---

::: v-pre

# Debugging

The **Protocol trace** records every event with:

- timestamp and direction (outgoing, incoming, local lifecycle)
- JSON-RPC method, id and kind (request / response / notification / error / stderr)
- request params and response result or error
- latency, measured by pairing each response with its request

Connection failures show a normalised explanation and suggestions, for example that the process exited before `initialize` or that stdout contains non-JSON output. Traces are redacted before display or storage.

:::
