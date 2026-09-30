---
title: "Elicitation, sampling and roots"
description: "Answer an MCP server's requests to the client while you inspect or test it: user input (elicitation), LLM completions (sampling) and roots."
---

::: v-pre

# Elicitation, sampling and roots

Some MCP servers ask the client for things while a tool runs. TestPion's MCP inspector supports all three client features, so these tools can be inspected and tested too.

| Feature | The server asks… | In the inspector | In a test |
|---|---|---|---|
| **Elicitation** | the user for input, with a JSON schema (e.g. a date to book a visit) | a form built from the schema, with **Accept**, **Decline** and **Cancel** | `elicitation:` with the answer |
| **Sampling** | the client for an LLM completion (messages, a system prompt, a token limit) | the request, and a reply you write or draft with **Draft with AI** (the AI assistant's model); nothing is sent to a model until you choose to | `sampling:` with a fixed reply |
| **Roots** | which folders it may work in | the workspace folder | `roots:` with paths or `file://` URIs |

The inspector declares these capabilities when it connects. The server waits while you answer (at most 10 minutes; disconnecting cancels). Only give a server what you'd give it: the dialog says which server asks.

## In tests

A `type: mcp` test answers with fixed values, so runs are repeatable. The capabilities are declared only for tests that set them.

```yaml
name: Booking asks for the date
type: mcp
server: clinic-mcp
tool: book_visit
elicitation:
  action: accept            # accept (default), decline or cancel
  content: { date: "{{visitDate}}", urgent: false }
assertions:
  - { type: equals, path: $.date, expected: "{{visitDate}}" }
```

```yaml
name: Summary uses the client's model
type: mcp
server: clinic-mcp
tool: summarize_notes
sampling: "Rex has a sprained left hind leg."     # or { text: …, model: … }
roots: ["./records"]
assertions:
  - { type: contains, expected: sprained }
```

What the server asked is recorded in the result (`serverRequests`) and in the test's trace. Without `elicitation:`, a server that checks the client's capabilities doesn't elicit; if it asks anyway, the request is declined.

:::
