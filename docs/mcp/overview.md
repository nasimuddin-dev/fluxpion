---
title: "MCP (Model Context Protocol) testing"
description: "Inspect, debug and test MCP servers: tools, resources, prompts and protocol traces."
---

::: v-pre

# MCP

FluxPion is a full MCP client built on the official TypeScript SDK:

- [Connect](./connecting.md) over **stdio**, **Streamable HTTP** or legacy **SSE**.
- Discover [tools](./tools.md), [resources, resource templates](./resources.md) and prompts.
- Run tools from forms generated from their JSON Schema, and save calls as regression tests.
- [Debug](./debugging.md) with a timeline of every JSON-RPC message.

Transport handling is isolated from the domain model: a tracing decorator wraps whichever transport is used.

:::
