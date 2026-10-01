---
title: "Datasets"
description: "Stream JSON, JSONL, CSV and Markdown datasets, or the rows of a SQLite query, into tests."
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

## SQLite databases

A SQLite database file (`.db`, `.sqlite`, `.sqlite3`) works as a dataset with a `query`: each row is a record and its columns are the fields.

```yaml
dataset:
  path: data/app.db
  query: SELECT email, plan FROM users WHERE active = ? ORDER BY id
  params: [1]              # ? placeholders; or { plan: pro } for :plan
  limit: 200
```

The database is opened read-only and the query must be one `SELECT` (`WITH … SELECT` and `VALUES` work too), so a dataset never changes it. BLOB columns arrive as base64 text.

The same works for collection runs: `testpion run-collection "My API" -d data/app.db --iteration-query "SELECT * FROM users"`, and in the app's Collection Runner, where picking a database shows its tables and a query box (it starts with the first table that has rows).

Other databases (PostgreSQL, MySQL) are not supported directly yet; export the rows to JSONL or CSV, or serve them from an API and use `url:`.

:::
