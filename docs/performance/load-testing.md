---
title: "Load testing"
description: "Load test HTTP endpoints, whole collections and LLM providers with virtual users, ramp-up, rate limits and safeguards."
---

::: v-pre

# Load testing

Configure virtual users, duration, ramp-up and ramp-down, a global requests-per-second cap, and think time. The results include throughput, p50/p90/p95/p99 latency, error rate, status code distribution and connection failures, with live charts.

LLM targets also report tokens per second, input and output tokens, estimated cost, time to first token, time between tokens and total generation time.

**Safeguards:** by default, only localhost and private-network hosts can be targeted. Remote hosts require an explicit opt-in and a confirmation. Environments marked as production are blocked unless you allow that environment for the run. The number of virtual users is capped in Settings. Only load test systems you own or are authorised to test.

```bash
testpion load http://127.0.0.1:4010/health --vus 50 --duration 30 --ramp-up 5
```

## Saved load tests

**Save** (next to the title) keeps the whole configuration: the target, headers and body, users, duration, ramp-up and ramp-down, rate limit, think time and pass/fail rules. It appears under **Saved** in the sidebar, where you can group load tests in folders and right-click one to **Run** it again. Saved load tests are kept in the workspace file `library/load-tests.json`. Run one from a terminal or CI by name; options you type there win over the saved ones, and `{{variables}}` resolve from the `-e` environment:

```bash
testpion load --saved "Health smoke" -e Staging --duration 30
```

## A whole collection

Choose **Collection** as the target in the **Load** view (or `testpion load --collection`) to load-test a user journey instead of one endpoint: every virtual user sends the collection's HTTP and GraphQL requests in order, again and again, like Postman's performance tests. Pick the whole collection or one folder.

- **Auth and variables:** the collection's auth inheritance applies, and variables come from the active environment. They are resolved once, before the load starts.
- **Warm-up:** scripts don't run under load (they would measure the script sandbox rather than the API). Turn on **Run it once first with scripts** (`--warm-up`) to run the selection once like the Collection Runner: values its scripts set, such as a login token, are then used by the load test. Variables that are still undefined are listed.
- **Cookies:** each virtual user keeps its own cookies, so a *log in → use the session → log out* sequence works for every user.
- **Results:** besides the totals, a **Per request** table shows each request's count, errors and p50/p95/p99, and how many passes through the collection were made.

```bash
testpion load --collection "Veterinary API" -w . -e Staging --folder Patients --warm-up --vus 20 --duration 60
```

## A gRPC method

Choose **gRPC method** as the target (or `testpion load <server> --grpc <method>`) to load-test a unary or server-streaming method: give the server (`localhost:50051`, `grpcs://host:443` for TLS), the method (`package.Service/Method`), the message as JSON and optional metadata. The methods come from the server through reflection (or `--proto` files in the CLI). Each virtual user calls the method again and again over one HTTP/2 connection; results count gRPC status codes (`OK`, `NOT_FOUND` …), and anything other than `OK` is an error.

```bash
testpion load localhost:50051 --grpc vet.v1.PetService/GetPet -d '{"id":"1"}' --vus 20 --duration 30 --threshold "p95<50"
```

## Pass or fail (thresholds)

Give rules that decide whether the test passed, like k6 thresholds. They're checked on the final numbers: in the **Load** view under **Pass if** (a green or red summary with each rule's actual value), and with `--threshold` in the CLI, which exits with 1 when a rule fails (so a CI job fails on a slow build):

```bash
testpion load http://127.0.0.1:4010/health --vus 20 --duration 30   --threshold "p95<300" "errors<1%" "rps>=100"
testpion load --collection "Veterinary API" -w . --threshold "p99[Get patient]<800" --json load.json
```

| Rule | Meaning |
|---|---|
| `p50`, `p90`, `p95`, `p99`, `avg`, `min`, `max` `< 500` | Latency in ms (`1s` works too). |
| `errors<1%` / `error_rate<1%` | Share of failed requests; `errors<5` is a count. |
| `rps>=50`, `requests>=1000` | Throughput and total requests. |
| `ttft_p95<800`, `tokens_per_sec>=20` | LLM targets. |
| `p95[Get patient]<400` | One request of a collection. |

Operators: `<`, `<=`, `>`, `>=`. A rule for a number the test didn't produce fails. Without thresholds, the CLI fails when more than 5% of requests failed. The `--json` file and the `load_test` MCP tool (`thresholds: [...]`) include each rule's result.

:::
