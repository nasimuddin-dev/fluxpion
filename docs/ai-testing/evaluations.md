---
title: "AI evaluation"
description: "Evaluate LLM output with deterministic, semantic and LLM-as-judge evaluators over streamed datasets, with regression baselines."
---

::: v-pre

# Evaluations

## Saved evaluations

Save an evaluation (its dataset, prompt, model, parameters and evaluators) with **Save** next to **Run**, and it appears under **Saved** in the sidebar. Group evaluations in folders (**New folder**, drag and drop, or **Move to folder**), and right-click one to **Run** it again, rename, duplicate or delete it. **Save** updates the evaluation you opened (it shows `Save*` when there are changes). **Save current evaluation** in a folder's menu saves a copy there. The **Runs** pane lists the runs of your evaluations; pick one to see its results.

Saved evaluations are kept in the workspace file `library/evaluations.json`, so they're versioned and shared with the workspace (use `{{variables}}` rather than typed-in keys).

Run them without the app, e.g. in CI or from an AI agent:

```bash
testpion eval list                       # name, folder, model, cases, evaluators (--json)
testpion eval run "Intent classification" -e Staging --limit 50 -r console junit
```

`eval run` exits `1` when a case fails, writes the usual reports, and works with `--baseline` / `--save-baseline` for regression checks. AI agents use the `list_evaluations` and `run_evaluation` tools of `testpion mcp-server`.

## Evaluator types

| Source | Evaluators |
|---|---|
| Deterministic | `exact-match`, `equals`, `contains`, `not-contains`, `regex`, `json-schema`, `json-path`, `type`, `length`, `threshold`, `latency`, `tokens`, `cost`, `is-json` |
| Heuristic | lexical `similarity` (cosine or token F1), RAG metrics, `refusal`, `no-leak` |
| Semantic | `similarity` with `method: embedding` using a provider's embeddings |
| AI judge | `llm-judge` with configurable `judge` model, `criteria` and `threshold` |

Every check result carries its **source**, and the UI and reports label AI-judge results clearly. Judge runs record the provider, model, temperature, prompt version and a config hash so they can be reproduced. They are **not** treated as deterministic.

## Datasets

JSON, JSONL, CSV and Markdown tables, from a file or a URL (API response), or the rows of a SQLite query ([Datasets](/test-runner/datasets#sqlite-databases)). JSONL and CSV are streamed line by line, so datasets of any size never need to fit in memory; quoted CSV fields may contain commas and line breaks. In the app, the dataset editor loads a file with **Load file…**, or one of the workspace's `datasets/` files from the list next to it (a response's **Table ▸ Save as dataset** puts one there).

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

Save a run as a **baseline**, then compare later runs against it using thresholds for latency (+%), tokens (+%) and score drop. New failures, score drops and metric regressions are highlighted. In the app (**Baselines** on a finished run), *Compare with* also lists earlier runs, to see what changed since then without saving a baseline; AI agents do the same with the `compare_runs` MCP tool. In CI:

```bash
testpion test tests/ai --baseline main --fail-on-regression
```

:::
