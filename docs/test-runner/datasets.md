---
title: "Datasets"
description: "Stream JSON, JSONL, CSV and Markdown datasets into tests."
---

::: v-pre

# Datasets

```yaml
dataset:
  path: cases.jsonl        # or url: https://…  (+ recordsPath: $.data)
  format: jsonl            # inferred from the extension
  expectedField: expected  # default "expected"
  idField: id
  limit: 1000
  offset: 0
```

- **LLM tests:** record fields become prompt variables, and `expected` comes from `expectedField`.
- **RAG tests:** records provide `question`, `contexts`, `answer` and `expected`.
- **Other types:** record fields become variables.

Direct database queries are not supported yet; export the rows to JSONL, or serve them from an API and use `url:`.

:::
