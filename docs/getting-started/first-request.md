---
title: "Your first request"
description: "Send an HTTP request, add assertions and save it to a collection."
---

::: v-pre

# Your first request

FluxPion opens on **Home**, with shortcuts to a new request, a GraphQL query, import, a new collection, MCP, the AI lab and these docs. It also shows your recent requests, collections and environments. Click an environment there to make it active.

1. Start the demo servers: `node examples/servers/demo-servers.mjs`.
2. In **Environments**, create `Development` with `baseUrl = http://127.0.0.1:4010`. The eye button next to the environment selector gives a [quick look](/api-testing/environments#quick-look) at its variables.
3. Click **New HTTP request** on Home (or open **REST**), enter `{{baseUrl}}/patients` and press **Ctrl/Cmd+Enter**.
4. The response is `401`. Open **Authorization**, choose **Bearer token** and use `demo-token-3f9a1c` (or better, a secret environment variable `{{accessToken}}`).
5. Send again. In **Tests**, add `status = 200` and `exists $.items[0].id`, then send once more to see them pass.
6. Press **Ctrl/Cmd+S** to save the request to a collection.

Variables resolved from the environment are shown in blue; unresolved ones are shown in red. Hover the URL to see where each value came from.

:::
