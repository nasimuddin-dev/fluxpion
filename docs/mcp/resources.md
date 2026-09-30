---
title: "MCP resources and prompts"
description: "Read MCP resources and resource templates (with the server's suggestions), subscribe to changes, and render MCP prompts."
---

::: v-pre

# Resources and prompts

- **Resources:** click one to read it. JSON content is shown as a tree.
- **Templates:** click one to get a field for each parameter of its URI template (e.g. `id` in `customer://{id}`); the URI is filled in as you type. Then **Read**.
- **Suggestions:** when the server offers completions (`completion/complete`), template parameters and prompt arguments suggest values as you type (for example the patient ids that start with what you typed).
- **Subscribe:** for servers that support resource subscriptions, **Subscribe** asks to be told when the resource changes; each `notifications/resources/updated` reads it again and says when it happened. **Subscribed** turns it off.
- **Prompts:** fill in the arguments and run **Get prompt** to see the rendered messages.

In tests, use `resource: customer://456` or `prompt: { name: summarize_customer, arguments: {...} }`.

:::
