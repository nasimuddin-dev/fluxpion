---
title: "Authentication"
description: "API key, Basic, Bearer, JWT, OAuth 2.0 (client credentials, password, authorization code with PKCE), custom headers and mTLS."
---

::: v-pre

# Authentication

| Type | Notes |
|---|---|
| API key | In a header or query parameter. |
| Basic | `Authorization: Basic …` |
| Bearer | Optional custom prefix. |
| JWT | Signed locally with HS256/384/512 from a JSON payload, with optional `exp`. |
| OAuth 2.0 | Client credentials, password, or authorization code with PKCE. The authorization-code flow opens your browser and captures the redirect on `127.0.0.1`. Tokens are cached in memory until they expire. |
| Custom headers | Any set of headers. |
| mTLS | Configured in request **Settings** (certificate, key, optional CA). |
| Inherit | Uses the auth from the nearest folder or collection. |

Every credential field accepts `{{variables}}`. Keep credentials in [secret environment variables](./environments.md#secrets) so they never end up in workspace files. Resolved credentials are automatically registered for redaction.

:::
