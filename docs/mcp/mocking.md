---
title: "MCP mock server"
description: "A fake MCP server from a YAML file, or recorded from a real one, to test AI agents and MCP clients without the real server or its side effects."
---

::: v-pre

# MCP mock server

An MCP mock is a fake MCP server: tools with canned responses, resources and prompts, defined in a `*.mcp-mock.yaml` file. Use it to:

- test an AI agent or MCP client against predictable answers, with no side effects (a mocked `delete_customer` deletes nothing);
- keep testing when the real server is slow, down, rate-limited or needs credentials;
- share a server's behaviour with people who can't run it.

## Record a mock from a real server

1. In **MCP**, connect to the server and call the tools you want to capture.
2. Click **Save as mock**.

TestPion writes `mocks/<server>.mcp-mock.yaml` in the workspace, with the server's tools (names, descriptions, input schemas, annotations), resources (and their text), prompts, and each tool call you made as a response matched on its arguments. Secrets in recorded content are redacted. A server entry *<server> (mock)* is added, so you can connect to the mock right away.

## Write one by hand

```yaml
name: customer-mock
instructions: A fake customer service
tools:
  - name: search_customer
    description: Look up a customer by id.
    inputSchema:
      type: object
      properties: { customer_id: { type: string } }
      required: [customer_id]
    responses:
      - when: { customer_id: "999" }      # used when the arguments contain these values
        text: "No customer {{args.customer_id}}"
        isError: true
      - json: { id: "123", name: "Ada Lovelace", tier: gold }   # the default
resources:
  - uri: clinic://hours
    name: Opening hours
    mimeType: text/plain
    text: Mon-Fri 8-18
prompts:
  - name: summarize
    arguments: [{ name: topic, required: true }]
    messages:
      - role: user
        text: "Summarize {{topic}} in one line."
```

A tool's first response whose `when` matches the arguments is used, otherwise the one without `when`. A response is `text` (with `{{args.name}}` placeholders), `json` (also sent as structured content) or raw MCP `content` items, and `isError: true` makes it a tool error.

## Use it

**In the app:** add an MCP server with the transport **Mock (definition file)** and the file's path in the workspace. The mock runs inside TestPion; saved MCP tests can use it like any other server.

**For AI agents and other clients:** serve it with the CLI.

```bash
testpion mock-mcp mocks/customer.mcp-mock.yaml              # stdio: the command an agent starts
testpion mock-mcp mocks/customer.mcp-mock.yaml --http -p 3333   # Streamable HTTP on 127.0.0.1
```

For example, in an agent's MCP configuration:

```json
{ "mcpServers": { "customer": { "command": "testpion", "args": ["mock-mcp", "mocks/customer.mcp-mock.yaml"] } } }
```

:::
