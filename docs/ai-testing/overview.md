---
title: "AI and LLM testing"
description: "Test LLM APIs across providers with prompt templates, structured output, streaming metrics, token usage and cost estimates."
---

::: v-pre

# AI testing

## Your Claude API key

The quickest way to start is your own Anthropic API key. Anthropic bills your account for what you use.

1. Create a key in the [Anthropic Console](https://console.anthropic.com/) (**API keys → Create key**).
2. In TestPion, open **Settings ▸ AI assistant** and turn on **the AI assistant**.
3. Choose **Claude (Anthropic), with your API key**, paste the key and choose **Save key**. TestPion checks it with Anthropic, then stores it in the OS secret store (Windows Credential Manager / DPAPI, the macOS Keychain, or the Linux secret service). It is never written to the settings file or to a workspace.
4. Choose the **model**: Claude Opus 5.5 (most capable, the default), Claude Sonnet 5.5 (faster and cheaper) or Claude Haiku 4.5 (fastest and cheapest), then **Save settings**.

The key then powers the AI assistant: explaining errors and responses, where a request's time went (Timeline), why a test failed or keeps flipping between runs (a result's History), why a monitor is failing, drafting requests, GraphQL queries, MCP arguments, assertions and tests. It also appears in every workspace's AI Lab and evaluations as the provider **Claude (your API key)**, so tests can use `model: { provider: claude-app, name: claude-sonnet-5-5 }`. To stop using it, turn the assistant off or choose **Remove key**. You can also point the assistant at a provider of the workspace instead, such as a local Ollama model.

For the CLI and CI, set the key as the `TESTPION_SECRET_APP_ANTHROPIC_APIKEY` environment variable: `claude-app` is then available there too.

## Saved prompts

The Playground's **Saved prompts** list keeps prompts with their model, parameters, system prompt, variables, structured output and evaluators, grouped in folders. **Save** stores the current prompt (or the changes to the opened one, shown as *edited*); open a prompt to run it again. Folders work as in the REST collections: create them with the folder button, and move prompts with the `⋯` / right-click menu or by dragging. Saved prompts live in the workspace (`library/ai-prompts.json`).

## Providers

| Kind | Notes |
|---|---|
| OpenAI-compatible | OpenAI, vLLM, LM Studio, OpenRouter and any `/chat/completions` server. |
| Azure OpenAI | Deployment URL plus `api-version`. |
| Anthropic | Messages API. |
| Google Gemini | `generateContent` / `streamGenerateContent`. |
| Amazon Bedrock | The Converse API, so every Bedrock model works the same way (text, system prompt, tools). The key is `accessKeyId:secretAccessKey` (add `:sessionToken` for temporary credentials), signed with AWS Signature V4, or a Bedrock API key. Set the region (or use a `bedrock-runtime.<region>` base URL). Answers arrive whole rather than streamed. Embeddings use Titan (default) or Cohere models. |
| Ollama | Local, OpenAI-compatible endpoint. |
| Mock | Offline and deterministic, with configurable rules. |

Providers support per-provider rate limits (requests per second or minute, tokens per minute, concurrency) and retries with exponential backoff that honour `Retry-After`.

## Metrics

Latency, time to first token, mean time between tokens, input, output and total tokens, and estimated cost. Cost comes from the price table you configure in Settings; no prices are built in, and each entry is versioned. When a provider doesn't report usage, tokens are estimated and labelled as such.

## Model comparison

Run the same prompt against several models and compare latency, tokens, cost, JSON and schema validity, and your evaluators side by side. The tool deliberately produces **no universal ranking**.

## Usage

The AI Lab's **Usage** tab adds up the prompts you ran: prompts, input and output tokens and estimated cost (from the price table) per model, with a bar per model and the median time and time to first token. `testpion history llm` prints the same, and agents use the `llm_usage` MCP tool.

<figure class="aps-screenshot">
  <img src="/images/ai-usage.jpg" alt="The AI Lab Usage tab: prompts run, input and output tokens, estimated cost, tokens per model and a table with median time and time to first token" width="1440" height="900" loading="lazy">
</figure>

Next: [prompts](./prompts.md), [evaluations](./evaluations.md), [RAG](./rag.md), [agents](./agents.md), [safety](./safety.md).

:::
