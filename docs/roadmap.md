---
title: Roadmap
description: What's planned for TestPion — more protocols, mock servers, signed installers and optional team features.
---

# Roadmap

Plans change with feedback. Vote or comment on [GitHub issues](https://github.com/nasimuddin-dev/testpion/issues).

## Next

- **Signed installers:** Windows Authenticode, and macOS Developer ID with notarization.
- **In-app update notifications.**
- **GraphQL subscriptions** over graphql-ws.
- **Mock servers for GraphQL and MCP.** HTTP mock servers from saved examples shipped in 0.2.0; a mock LLM provider already exists.
- **Published CLI package** on npm.

## Shipped in 0.2.0

Cookie jar, saved examples and HTTP mock servers, request and collection documentation, Postman v2.1 export, a console, pinned tabs, a Home view, `pm.sendRequest`, folder scripts and variables, AI help in the request builder, and `testpion mcp-server` for AI agents. See the [changelog](/changelog).

## Later

- gRPC, MQTT and Kafka protocol adapters.
- A native AWS Bedrock provider.
- Database-query datasets.
- OpenTelemetry export of traces.
- Scheduled runs and synthetic monitoring.

## Optional cloud features (not in the local-first core)

Team workspaces, cloud execution, centralised reports, SSO and role-based access. These will always be optional; the desktop app and CLI will keep working fully offline.
