---
title: Features
description: Everything TestPion does — REST, GraphQL, gRPC, WebSocket and MCP testing, an AI Lab with model comparison, evaluations for LLMs, RAG and agents, a scalable test runner, load testing and traces.
---

# Features

TestPion combines an API client, a GraphQL playground, an MCP inspector, an LLM playground, an evaluation lab, a test runner, a load tester and a trace viewer. They all share one execution engine, which the [`testpion` CLI](/cli/reference) also uses.

## REST and HTTP

<figure class="aps-screenshot">
  <img src="/images/rest.jpg" alt="The REST view with a collection tree, a request, and its JSON response" width="1440" height="900" loading="lazy">
</figure>

- Any method, params, headers and cookies; JSON, XML, text, HTML, form, multipart and binary bodies.
- A per-workspace cookie jar, like Postman's: cookies from responses (including redirects) are sent with later requests and managed in a Cookies dialog. The jar is encrypted on your machine and never written to workspace files.
- API key, Basic, Bearer, JWT, OAuth 2.0 (client credentials, password, authorization code with PKCE), AWS Signature v4, Digest, custom headers and mTLS, inherited from folders and collections.
- Responses as a virtualised JSON tree, raw text with search, or an HTML preview, plus headers, cookies and a timing breakdown. Large bodies stream to disk.
- Save responses as examples of a request (success and error cases), with secrets masked. Postman saved responses import as examples.
- Mock servers on localhost serve a collection's examples, from the app or with `testpion mock`.
- Markdown docs for every request and a generated documentation page per collection, exportable as Markdown or with `testpion docs`.
- Pre-request and test scripts in a sandbox, assertions, highlighted variables, one-click cURL export, a response Visualizer (`pm.visualizer`), paste-to-request from browser devtools (cURL, fetch, PowerShell), and a console with every request and its script output.
- Star frequently used REST or GraphQL requests from their **⋯** menu, then use the star button beside the collection filter to focus the REST sidebar on favorites. Favorites are saved in the collection file and retain their folder context.

[REST guide](/api-testing/rest) · [Authentication](/api-testing/authentication) · [Collections & import](/api-testing/collections)

## GraphQL

<figure class="aps-screenshot">
  <img src="/images/graphql.jpg" alt="The GraphQL view with the schema explorer, a query in the editor and the response" width="1440" height="900" loading="lazy">
</figure>

Introspect a schema to get autocomplete, validation and hover docs in the editor, plus a browsable schema explorer. Run operations with variables and assert on data, GraphQL errors and latency.

[GraphQL guide](/graphql/overview)

## gRPC

- Calls services described by `.proto` files; imports and Google's well-known types resolve.
- Unary, server-streaming, client-streaming and bidirectional methods, with example messages.
- Metadata, TLS (`grpcs://`) and deadlines.
- Streamed responses appear live; **Stop** keeps what arrived.

See [gRPC](./api-testing/grpc.md).

## MCP inspector

<figure class="aps-screenshot">
  <img src="/images/mcp-trace.jpg" alt="The MCP protocol trace listing initialize, tools/list and tools/call messages with latencies" width="1440" height="900" loading="lazy">
</figure>

- stdio, Streamable HTTP and SSE transports.
- Tools, resources, resource templates and prompts, with input forms generated from JSON Schema.
- A protocol trace of every JSON-RPC message, with direction, payloads and latency.
- **Save as test** turns a tool call into a regression test.
- The other direction too: `testpion mcp-server` serves your workspace to AI agents as MCP tools (browse collections, send requests, run collections), with secrets redacted.

[MCP guide](/mcp/overview) · [Use from AI agents](/ai-testing/mcp-server)

## AI Lab and model comparison

<figure class="aps-screenshot">
  <img src="/images/ai-lab.jpg" alt="The AI Lab playground with a streaming response and metrics" width="1440" height="900" loading="lazy">
</figure>

Prompt templates with variables, JSON mode and JSON Schema outputs, and streaming with time to first token. Token counts and estimated cost from a price table you control. Compare models side by side without a one-size-fits-all ranking. Providers include OpenAI-compatible, Azure OpenAI, Anthropic, Gemini, Ollama and an offline mock.

[AI testing guide](/ai-testing/overview)

## Evaluations

<figure class="aps-screenshot">
  <img src="/images/evaluations.jpg" alt="The Evaluations view with a JSONL dataset and a completed run" width="1440" height="900" loading="lazy">
</figure>

Stream JSONL, CSV, JSON or Markdown datasets through evaluators. **Deterministic** evaluators cover exact match, JSON Schema, regex and thresholds. **Heuristic and semantic** evaluators cover similarity and RAG metrics. **LLM-as-judge** scores are clearly labelled and reproducible. Also included: agent tool-use checks, safety checks (prompt injection, data leakage, tool misuse), and baselines for regression tracking.

[Evaluations](/ai-testing/evaluations) · [RAG](/ai-testing/rag) · [Agents](/ai-testing/agents) · [Safety](/ai-testing/safety)

## Test runner and CI

<figure class="aps-screenshot">
  <img src="/images/tests.jpg" alt="The Tests view with test files, a completed run and the checks of an agent test" width="1440" height="900" loading="lazy">
</figure>

YAML tests in your repository, with parallel workers, backpressure, retries, timeouts, dependencies, setup and teardown, and runs you can cancel and resume. Every run writes JUnit, JSON, HTML and Markdown reports. The CLI returns CI-friendly exit codes.

[Test runner](/test-runner/overview) · [CI/CD](/test-runner/ci-cd)

## Load testing

<figure class="aps-screenshot">
  <img src="/images/load.jpg" alt="The Load view with live throughput, latency, error and virtual-user charts" width="1440" height="900" loading="lazy">
</figure>

Configure virtual users, ramp-up and ramp-down, and an RPS cap. See p50–p99 latency, error rate and status distribution, plus AI metrics (tokens/s, TTFT, cost) for LLM targets. Safeguards block production and remote hosts unless you opt in.

[Load testing](/performance/load-testing)

## Traces

<figure class="aps-screenshot">
  <img src="/images/traces.jpg" alt="A trace waterfall with nested spans and span attributes" width="1440" height="900" loading="lazy">
</figure>

Every request, GraphQL operation, MCP call, LLM call, tool call and evaluation becomes a span in an OpenTelemetry-shaped trace, shown as a waterfall with inputs, outputs and attributes.

## Workspace and productivity

<figure class="aps-screenshot">
  <img src="/images/home.jpg" alt="The Home view with a greeting, the active environment, colour-coded quick actions, and cards for recent requests, collections and environments" width="1440" height="900" loading="lazy">
</figure>

A Home view with quick actions and recent work, collections, environments with variable precedence and a quick look, secret variables, searchable history grouped by day, global search, a command palette (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>), an AI assistant that turns plain words into requests, writes pm tests and explains errors (always labelled as AI-generated), and dark and light themes. Import from OpenAPI, Postman or HAR, and export collections and environments to Postman v2.1.
