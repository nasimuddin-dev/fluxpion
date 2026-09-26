---
title: "GraphQL"
description: "Execute GraphQL queries and mutations with variables, headers and auth, and assert on data and errors."
---

::: v-pre

# GraphQL

Enter the endpoint (variables allowed), then write the operation in the Monaco editor. Variables, headers, auth and assertions have their own tabs. If a document contains several operations, choose which one to run.

- **Ctrl/Cmd+Enter** runs the operation, **Prettify** formats it, and **Generate** asks the AI assistant to draft a query from the schema.
- Responses appear as a JSON tree. GraphQL `errors` are counted and can be asserted on.
- Subscriptions need a WebSocket transport (graphql-ws), which this release does not include. You can test them manually in the WebSocket view.

See [schema explorer](./schema-explorer.md) and [testing](./testing.md).

:::
