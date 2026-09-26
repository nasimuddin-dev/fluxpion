---
title: "Privacy and redaction"
description: "Redaction of logs, traces, reports and exports; the script sandbox; and telemetry."
---

::: v-pre

# Privacy

## Redaction

Everything written to logs, traces, history, results, reports and exports passes through a redactor that masks:

1. **Sensitive field names:** `password`, `token`, `apiKey`, `authorization`, `cookie`, `secret`, `ssn`, `creditCard` and more. These are configurable in Settings and matched case-insensitively, including as suffixes (`accessToken`, `x-api-key`).
2. **Known secret values:** every secret resolved during a run is registered, and any occurrence inside any string is masked (URLs, bodies, error messages). Tokens obtained at runtime (OAuth, `extract:` into sensitive names) are registered too.

## Script sandbox

Scripts run in **QuickJS compiled to WebAssembly**, a separate JavaScript engine with its own heap. There is no filesystem, network, process, `require` or host-realm access. CPU time (2 s by default) and memory (32 MB) are limited. Data crosses the boundary only as JSON.

## Telemetry

Telemetry is not implemented. Request bodies, API keys, prompts and responses are sent only to the endpoints and providers you call.

:::
