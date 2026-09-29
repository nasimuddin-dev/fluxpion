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
| `openapi` | `spec` (an OpenAPI 3 / Swagger 2 file in the workspace, or the document inline), `operationId` (optional). See [contract testing](#openapi-contract-testing). |
| `type`, `length`, `threshold`, `greater-than`, `less-than` | `path`, `expected` / `min` / `max` |
| `latency`, `tokens`, `cost` | `max` (`tokens` also takes `field: input\|output\|total`) |
| `header` | `header`, `expected` |
| `graphql-no-errors`, `graphql-errors` | `expected` (count or message) |
| `grpc-status` | `expected`: a gRPC status name (`OK`, `NOT_FOUND` …), a code, or a list. Default `OK`. |
| AI, RAG, agent and safety checks | see [evaluations](../ai-testing/evaluations.md) |

Check options can use variables, e.g. `expected: "{{expected}}"`. Script tests (`pm.test`) also appear as checks.

## OpenAPI contract testing

The `openapi` check verifies that a response keeps the API's contract, as documented in its OpenAPI (3.0, 3.1) or Swagger 2.0 document:

1. The request is matched to an operation by method and path. Server base paths (`servers`, `basePath`) and templates such as `/pets/{id}` are understood, and literal paths win over templated ones. Give `operationId` to name the operation yourself.
2. The response status must be documented for that operation (exactly, as `2XX`, or through `default`).
3. Its content type must be documented.
4. The body must match the documented schema, including `$ref`s, `nullable`, enums, formats and `additionalProperties`. Every violation is listed, e.g. `/species must be equal to one of the allowed values: cat, dog`.

```yaml
name: Get a pet
type: http
url: "{{baseUrl}}/v1/pets/1"
assertions:
  - type: openapi
    spec: openapi.yaml        # relative to the workspace (or to the current folder when there is no workspace)
```

In the app, add **Matches OpenAPI contract** under a request's assertions. The document is read from the workspace only; paths can't point outside it.

:::
