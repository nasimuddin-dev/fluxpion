---
title: "AI evaluation"
description: "Evaluate LLM output with deterministic, semantic and LLM-as-judge evaluators over streamed datasets, with regression baselines."
---

::: v-pre

# Evaluations

## Evaluator types

| Source | Evaluators |
|---|---|
| Deterministic | `exact-match`, `equals`, `contains`, `not-contains`, `regex`, `json-schema`, `json-path`, `type`, `length`, `threshold`, `latency`, `tokens`, `cost`, `is-json` |
| Heuristic | lexical `similarity` (cosine or token F1), RAG metrics, `refusal`, `no-leak` |
| Semantic | `similarity` with `method: embedding` using a provider's embeddings |
| AI judge | `llm-judge` with configurable `judge` model, `criteria` and `threshold` |

Every check result carries its **source**, and the UI and reports label AI-judge results clearly. Judge runs record the provider, model, temperature, prompt version and a config hash so they can be reproduced. They are **not** treated as deterministic.

## Datasets

JSON, JSONL, CSV and Markdown tables, from a file or a URL (API response). JSONL and CSV are streamed line by line, so datasets of any size never need to fit in memory.

```yaml
name: Intent dataset
type: llm
model: { provider: openai, name: my-model, temperature: 0 }
prompt: "Classify as JSON {\"intent\": ...}: {{message}}"
dataset:
  path: ../../datasets/intents.jsonl
evaluators:
  - { type: exact-match, path: $.intent, expected: "{{expected}}" }
```

Each record's fields are available as variables in both the prompt and the evaluators.

## Regression

Save a run as a **baseline**, then compare later runs against it using thresholds for latency (+%), tokens (+%) and score drop. New failures, score drops and metric regressions are highlighted. In CI:

```bash
fluxpion test tests/ai --baseline main --fail-on-regression
```

:::
