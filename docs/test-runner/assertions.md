---
title: "Assertions reference"
description: "All assertion and evaluator types with options."
---

::: v-pre

# Assertions

All checks share `type`, an optional `name`, and usually `path` (JSONPath such as `$.data.items[0].id`) and `expected`.

| Type | Options |
|---|---|
| `status` / `http-status` | `expected`: `200`, `"2xx"`, `[200, 201]`, `success`, `error` |
| `exists`, `not-exists` | `path` |
| `equals`, `not-equals`, `exact-match` | `path`, `expected`, `ignoreCase`, `trim` |
| `contains`, `not-contains` | `path`, `expected` (a string or a list; `any: true`) |
| `regex`, `not-regex` | `path`, `expected` / `pattern`, `flags` |
| `json-schema` | `path`, `schema` (inferred from `expected` if omitted) |
| `type`, `length`, `threshold`, `greater-than`, `less-than` | `path`, `expected` / `min` / `max` |
| `latency`, `tokens`, `cost` | `max` (`tokens` also takes `field: input\|output\|total`) |
| `header` | `header`, `expected` |
| `graphql-no-errors`, `graphql-errors` | `expected` (count or message) |
| AI, RAG, agent and safety checks | see [evaluations](../ai-testing/evaluations.md) |

Check options can use variables, e.g. `expected: "{{expected}}"`. Script tests (`pm.test`) also appear as checks.

:::
