---
title: "Development guide"
description: "Set up a development environment, run tests and build the app."
---

::: v-pre

# Development

```bash
npm install
npm run build          # core → cli → desktop
npm test               # unit, integration and end-to-end tests (vitest)
npm run typecheck
npm run dev            # Electron
npm run dev:web        # browser + local bridge
node examples/servers/demo-servers.mjs   # local REST/GraphQL/LLM/WebSocket demo servers
```

Every feature ships with an implementation, unit tests, integration tests, documentation and an example (Appendix E).

:::
