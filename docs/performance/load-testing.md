---
title: "Load testing"
description: "Load test HTTP endpoints and LLM providers with virtual users, ramp-up, rate limits and safeguards."
---

::: v-pre

# Load testing

Configure virtual users, duration, ramp-up and ramp-down, a global requests-per-second cap, and think time. The results include throughput, p50/p90/p95/p99 latency, error rate, status code distribution and connection failures, with live charts.

LLM targets also report tokens per second, input and output tokens, estimated cost, time to first token, time between tokens and total generation time.

**Safeguards:** by default, only localhost and private-network hosts can be targeted. Remote hosts require an explicit opt-in and a confirmation. Environments marked as production are blocked unless you allow that environment for the run. The number of virtual users is capped in Settings. Only load test systems you own or are authorised to test.

```bash
fluxpion load http://127.0.0.1:4010/health --vus 50 --duration 30 --ramp-up 5
```

:::
