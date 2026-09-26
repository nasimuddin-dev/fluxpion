---
title: "Testing MCP tools"
description: "Execute MCP tools with schema-generated forms, assert on results and save tool calls as tests."
---

::: v-pre

# Tools

Select a tool to see its description, input and output schemas and annotations. Tools marked `destructiveHint` are flagged and ask for confirmation before running.

- **Arguments:** use the form generated from the input schema, or switch to raw JSON. **Generate args** asks the assistant for example arguments.
- **Execute:** shows the content blocks (text, JSON, images), `structuredContent`, `isError` and latency.
- **Assertions:** `status: success|error`, JSONPath checks against `structuredContent`, or the parsed text content.
- **Save as test:** writes a YAML test to `tests/mcp/`:

```yaml
name: Search Customer MCP Tool
type: mcp
server: customer-mcp
tool: search_customer
arguments: { customer_id: "123" }
assertions:
  - { type: status, expected: success }
  - { type: equals, path: $.customer.id, expected: "123" }
```

`status: error` matches only a tool-level error (`isError: true`). A connection or protocol failure counts as a test **error**, never as the expected error.

:::
