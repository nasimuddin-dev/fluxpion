---
title: "GraphQL subscriptions"
description: "Run GraphQL subscriptions over WebSocket (graphql-transport-ws and graphql-ws) and watch the events arrive."
---

::: v-pre

# GraphQL subscriptions

Write a `subscription` operation in the GraphQL view and **Run** becomes **Subscribe**. TestPion opens a WebSocket to the endpoint (`http://` and `https://` become `ws://` and `wss://`), subscribes, and lists every event as it arrives. Click one to see its data as a JSON tree. **Stop** ends the subscription; a server that completes it ends it too.

```graphql
subscription OnPatientUpdated($id: ID!) {
  patientUpdated(id: $id) { id name weight }
}
```

- **Protocols:** both in use are offered and the server picks one: `graphql-transport-ws` (the graphql-ws library, used by Apollo Server 4, GraphQL Yoga, Hasura …) and the older `graphql-ws` (subscriptions-transport-ws). The one in use is shown above the events.
- **Auth:** the Auth tab and Headers are sent with the WebSocket handshake. For servers that read credentials from the first message instead, put them in the **Connection** tab: it's the `connection_init` payload, e.g. `{ "authorization": "Bearer {{token}}" }`.
- Variables and `{{variables}}` work as for queries. Secret values are masked in the event list.

From the terminal, and for AI agents:

```bash
testpion graphql-subscribe https://api.example.com/graphql -q 'subscription { patientUpdated { id name } }' --max 5 --duration 30 --json
```

The MCP tool `graphql_subscribe` returns the events received within a limit (at most 60 seconds).

:::
