---
title: "Examples workspace"
description: "The TestPion Examples workspace: ready-to-run requests and tests for REST, SOAP, GraphQL, gRPC, WebSocket, MQTT, SSE, MCP and AI against free public APIs."
---

# Examples workspace

TestPion comes with a **TestPion Examples** workspace. It opens the first time you start the app, and you can open it again at any time from **Help ▸ Open Examples Workspace** or the link on the Home page. Everything in it works against free public services, with nothing to install or configure. Select the **Public APIs** environment (it is selected for you) and press **Send**.

The workspace is copied into your data folder once. You can change it freely: app updates never overwrite your copy.

## What's inside

| Area | Where | Uses |
|---|---|---|
| REST basics: methods, query parameters, JSON and form bodies, headers, redirects, XML, images, JSON Schema checks | Collection **HTTP basics (httpbin)** | [httpbin.org](https://httpbin.org) |
| Authentication: Basic, Bearer, Digest, API key; cookies | Same collection, **Authentication** and **Cookies** folders | httpbin.org |
| Scripts and chaining (`pm.*`), path variables, a `pm.visualizer` table | Collection **Scripts & chaining (JSONPlaceholder)**; run it in order | [JSONPlaceholder](https://jsonplaceholder.typicode.com) |
| OpenAPI contract testing (`openapi` check against `specs/petstore.json`) | Collection **Swagger Petstore (OpenAPI contract)** | [Swagger Petstore](https://petstore3.swagger.io) |
| GraphQL queries with variables, and an error case | Collection **GraphQL (Countries, Rick and Morty)**; open it in the GraphQL view to browse the schema | [Countries](https://countries.trevorblades.com), [Rick and Morty](https://rickandmortyapi.com) |
| Server-Sent Events, live | Collection **Live streams (SSE)**; press Stop when you've seen enough | [Wikimedia EventStreams](https://stream.wikimedia.org) |
| gRPC through server reflection (no `.proto` files): unary, server streaming | gRPC view ▸ **Saved requests** | grpcb.in |
| WebSocket echo | WebSocket view ▸ **Saved connections**; tests in Tests ▸ `websocket/echo.yaml` | Postman echo, echo.websocket.org |
| MQTT publish and subscribe | WebSocket view ▸ **Saved connections ▸ MQTT brokers**; test in Tests ▸ `websocket/mqtt.yaml` | [test.mosquitto.org](https://test.mosquitto.org) |
| SOAP, imported from a WSDL | Collection **SOAP: Number Conversion** (SOAP 1.1 and 1.2; tests read the XML with `xml2Json`) | [DataAccess NumberConversion](https://www.dataaccess.com/webservicesserver/NumberConversion.wso) |
| MCP over Streamable HTTP | MCP view ▸ **Petstore MCP**, **DeepWiki** | petstore.run.mcp.com.ai, mcp.deepwiki.com |
| MCP mock (offline) | MCP view ▸ **Weather (offline mock)**, from `mocks/weather.mcp-mock.yaml` | none |
| AI prompts: JSON output, summaries, a prompt injection | AI Lab ▸ **Saved prompts** | the offline demo model |
| Evaluation over a dataset, safety, RAG, an agent that calls MCP tools | Tests ▸ `ai/`, `agent/` | the offline demo model (+ Petstore MCP for the agent) |
| Test suites | Tests ▸ **All examples** (everything) and **Offline** (no internet needed) | |
| Monitor (paused) | Monitors ▸ **Public APIs health** | httpbin.org |
| Traces | Traces view: every request, MCP call, model call and test run adds one | |

## The offline demo model

AI examples use **Offline demo model**, a deterministic stand-in that runs inside TestPion. It classifies the example intents, refuses the prompt injection, answers the RAG question and calls the Petstore MCP tool. It is set up in **Settings ▸ Providers**, with rules (regular expression → reply or tool call) in its `x-mock-rules` header. So evaluations, safety tests and the agent test run without an API key and give the same result every time.

To try a real model, add an API key to **OpenAI**, **Anthropic** or **Google Gemini** under **Settings ▸ Providers**, or start Ollama locally. Then pick that provider in AI Lab, or change `provider:` in a test file.

## From the terminal

The same workspace is in the repository at `examples/public-workspace`, so the CLI and AI agents can use it too:

```bash
testpion run -w examples/public-workspace --suite all      # everything (needs internet)
testpion run -w examples/public-workspace --suite offline  # no internet needed
testpion run-collection "HTTP basics (httpbin)" -w examples/public-workspace -e "Public APIs"
testpion grpc grpcb.in:9000 hello.HelloService/SayHello -d '{"greeting":"hi"}'
testpion mcp --url https://petstore.run.mcp.com.ai/mcp
```

::: warning Public services
These are free services run by other people. They can be slow, rate-limited, or down for a while, and shared ones such as the Petstore change as other people use them. A failure in the examples is not always a TestPion problem. For tests that must be stable, use your own API or a [mock server](/api-testing/mock-servers).
:::
