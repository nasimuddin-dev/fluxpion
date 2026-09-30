---
title: "AI and LLM testing"
description: "Test LLM APIs across providers with prompt templates, structured output, streaming metrics, token usage and cost estimates."
---

::: v-pre

# AI testing

## Saved prompts

The Playground's **Saved prompts** list keeps prompts with their model, parameters, system prompt, variables, structured output and evaluators, grouped in folders. **Save** stores the current prompt (or the changes to the opened one, shown as *edited*); open a prompt to run it again. Folders work as in the REST collections: create them with the folder button, and move prompts with the `⋯` / right-click menu or by dragging. Saved prompts live in the workspace (`library/ai-prompts.json`).

## Providers

| Kind | Notes |
|---|---|
| OpenAI-compatible | OpenAI, vLLM, LM Studio, OpenRouter and any `/chat/completions` server. |
| Azure OpenAI | Deployment URL plus `api-version`. |
| Anthropic | Messages API. |
| Google Gemini | `generateContent` / `streamGenerateContent`. |
| Ollama | Local, OpenAI-compatible endpoint. |
| Mock | Offline and deterministic, with configurable rules. |

AWS Bedrock is not built in; use an OpenAI-compatible gateway in front of it. Providers support per-provider rate limits (requests per second or minute, tokens per minute, concurrency) and retries with exponential backoff that honour `Retry-After`.

## Metrics

Latency, time to first token, mean time between tokens, input, output and total tokens, and estimated cost. Cost comes from the price table you configure in Settings; no prices are built in, and each entry is versioned. When a provider doesn't report usage, tokens are estimated and labelled as such.

## Model comparison

Run the same prompt against several models and compare latency, tokens, cost, JSON and schema validity, and your evaluators side by side. The tool deliberately produces **no universal ranking**.

Next: [prompts](./prompts.md), [evaluations](./evaluations.md), [RAG](./rag.md), [agents](./agents.md), [safety](./safety.md).

:::
