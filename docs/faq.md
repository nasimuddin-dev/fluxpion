---
title: FAQ
description: Frequently asked questions about AI Protocol Studio — pricing, privacy, supported protocols and AI providers, MCP, CI usage and data locations.
---

# Frequently asked questions

## Is AI Protocol Studio free?

Yes. It's open source under the MIT license, with no account, subscription or paid tier.

## Does it send my requests, prompts or API keys anywhere?

No. Requests go only to the servers you call, and prompts only to the AI provider you choose. There's no telemetry. Secrets are encrypted with your operating system's credential store and redacted from logs, traces, history and reports. See [privacy](/security/privacy).

## Which AI providers are supported?

OpenAI and any OpenAI-compatible server (vLLM, LM Studio, OpenRouter and others), Azure OpenAI, Anthropic, Google Gemini, Ollama for local models, and a built-in offline mock. AWS Bedrock works through an OpenAI-compatible gateway. See [AI testing](/ai-testing/overview).

## Do I need an internet connection?

No for local APIs, local MCP servers, local models (Ollama) and the mock provider. Cloud AI providers and remote APIs need network access, of course.

## Which MCP transports can I connect to?

stdio (a local command), Streamable HTTP and the legacy SSE transport. See [connecting](/mcp/connecting).

## Can I run my tests in CI?

Yes. Tests are YAML files in your repository, and the [`aipstudio` CLI](/installation/cli) runs them with JUnit, JSON, HTML and Markdown reports and standard exit codes. See [CI/CD](/test-runner/ci-cd).

## Can I import my Postman collections or OpenAPI specs?

Yes: OpenAPI 3 and Swagger 2 (JSON or YAML), Postman v2.1 collections and environments, and HAR files. See [collections](/api-testing/collections).

## Are LLM-as-judge scores reliable?

They're useful but not deterministic, so AI Protocol Studio always labels them as **AI judge** results and records the judge's model, temperature, prompt version and a config hash. Use deterministic checks (exact match, JSON Schema, regex) for hard requirements. See [evaluations](/ai-testing/evaluations).

## How big can responses and test suites get?

Response bodies stream to disk, and the viewer only shows a preview (2 MB by default), so 100 MB+ responses are fine. Test suites and datasets are streamed rather than loaded at once, so runs with hundreds of thousands of tests work. See [benchmarks](/performance/benchmarks).

## Where is my data stored?

In `~/.aipstudio` (`%USERPROFILE%\.aipstudio` on Windows): settings, logs, encrypted secrets and workspaces. A workspace can also live in any folder you open, such as one in a git repository.

## Why does Windows or macOS warn me when installing?

The installers aren't code-signed yet. The [Windows](/installation/windows) and [macOS](/installation/macos) guides show how to proceed safely.

## How do I report a bug or request a feature?

Open an issue on [GitHub](https://github.com/nasimuddin-dev/protolens/issues). Report security problems privately as described in [SECURITY.md](https://github.com/nasimuddin-dev/protolens/blob/main/SECURITY.md).
