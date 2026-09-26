---
title: "Agent testing"
description: "Test agentic tool-calling workflows with mock tools and MCP tools, with full step-by-step traces."
---

::: v-pre

# Agent testing

`type: agent` runs a provider-agnostic tool-calling loop. The tools can be mocks, MCP server tools, or both:

```yaml
name: Booking agent uses the right tools
type: agent
model: { provider: openai, name: my-model }
input: Please book an appointment for customer 123.
mcpServers: [customer-mcp]
tools:
  - name: get_weather
    inputSchema: { type: object, properties: { city: { type: string } } }
    result: { forecast: sunny, city: "{{args.city}}" }
maxSteps: 4
evaluators:
  - { type: tool-called, tool: create_appointment, arguments: { customer_id: "123" } }
  - { type: tool-not-called, tool: delete_customer }
  - { type: max-tool-calls, max: 3 }
  - { type: tool-args-valid }
  - { type: tool-sequence, expected: [search_customer, create_appointment] }
```

The trace records every model call (prompt, tokens, finish reason), every tool call (arguments, result, latency, source) and the final answer.

:::
