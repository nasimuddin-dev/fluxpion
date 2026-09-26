---
title: "RAG evaluation"
description: "Evaluate retrieval-augmented generation: context precision and recall, groundedness, answer relevance, citations and hallucination indicators."
---

::: v-pre

# RAG testing

```yaml
name: Clinic opening hours
type: rag
question: What time does the clinic open on weekdays?
contexts:
  - { id: doc-1, text: "Happy Paws Clinic opens at 8am…", score: 0.92 }
  - { id: doc-2, text: "Parking is available…", score: 0.41 }
expected: The clinic opens at 8am on weekdays.
model: { provider: openai, name: my-model }   # or `answer:` with your system's answer
```

| Metric | Method |
|---|---|
| `context-precision` | Rank-aware share of retrieved documents relevant to the question and expected answer. Heuristic. |
| `context-recall` | Share of expected-answer sentences supported by the contexts. Heuristic. |
| `groundedness` | Share of answer sentences supported by the contexts; also reports `hallucinationIndicator`. Heuristic, or AI judge with `judge:`. |
| `answer-relevance` | Heuristic, or AI judge with `judge:`. |
| `citation` | `[id]` citations must refer to retrieved documents. Deterministic. |

The result stores the query, document IDs, scores, model, prompt hash, answer and evaluation, as required by §15.

:::
