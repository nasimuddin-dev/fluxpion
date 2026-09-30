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

## A whole collection

Choose **Collection** as the target in the **Load** view (or `testpion load --collection`) to load-test a user journey instead of one endpoint: every virtual user sends the collection's HTTP and GraphQL requests in order, again and again, like Postman's performance tests. Pick the whole collection or one folder.

- **Auth and variables:** the collection's auth inheritance applies, and variables come from the active environment. They are resolved once, before the load starts.
- **Warm-up:** scripts don't run under load (they would measure the script sandbox rather than the API). Turn on **Run it once first with scripts** (`--warm-up`) to run the selection once like the Collection Runner: values its scripts set, such as a login token, are then used by the load test. Variables that are still undefined are listed.
- **Cookies:** each virtual user keeps its own cookies, so a *log in → use the session → log out* sequence works for every user.
- **Results:** besides the totals, a **Per request** table shows each request's count, errors and p50/p95/p99, and how many passes through the collection were made.

```bash
testpion load --collection "Veterinary API" -w . -e Staging --folder Patients --warm-up --vus 20 --duration 60
```

:::
