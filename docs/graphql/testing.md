---
title: "GraphQL tests"
description: "Write GraphQL tests in YAML with HTTP status, GraphQL error and JSONPath assertions."
---

::: v-pre

# GraphQL tests

```yaml
name: Get Patient
type: graphql
endpoint: "{{graphqlEndpoint}}"
query: |
  query GetPatient($id: ID!) {
    patient(id: $id) { id name species }
  }
variables:
  id: "123"
assertions:
  - type: http-status
    expected: 200
  - type: graphql-no-errors
  - type: exists
    path: $.data.patient.id
  - type: latency
    max: 500
```

`graphql-errors` asserts that errors occurred, either as a count (`expected: 1`) or by message (`expected: Cannot query field`). A GraphQL test without assertions checks `graphql-no-errors` by default.

:::
