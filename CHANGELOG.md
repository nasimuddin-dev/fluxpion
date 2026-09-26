# Changelog

## 0.1.0 — 2026-09-26

First implementation of the AI Protocol Studio SRS (Phases 0–8, local-first):

- Core engine (`@aps/core`): HTTP, GraphQL, MCP (stdio, Streamable HTTP, SSE) and WebSocket adapters; OpenAI-compatible, Azure OpenAI, Anthropic, Gemini, Ollama and mock providers; agent loop; variables with scope precedence; QuickJS script sandbox; assertion and evaluator engine (deterministic, heuristic, semantic, LLM-as-judge, RAG, agent, safety); tracer; streaming runner with retries, dependencies and checkpoints; reports; regression baselines; load testing; workspace storage with migrations, SQLite metadata and encrypted secrets; OpenAPI, Postman and HAR importers.
- Desktop app (Electron + React): REST, GraphQL, WebSocket, MCP, AI Lab, Evaluations, Tests, Load, Traces, Collections, History, Environments and Settings views; command palette; global search; AI assistant.
- CLI (`aipstudio`): `test`, `run`, `load`, `import`, `workspace`, `mcp` and `report` commands, with CI exit codes and JUnit, JSON, HTML and Markdown output.
- Installers: Windows (installer and portable), macOS (Apple Silicon and Intel `.dmg`) and Linux (AppImage, `.deb`, `.rpm`), built by the release workflow.
- Website and documentation at https://nasimuddin-dev.github.io/protolens/, with download page, installation guides, features, FAQ and roadmap.
- Example workspace, demo servers and a benchmark.
