---
title: "Secrets"
description: "How secrets are stored and supplied, and how they are redacted."
---

::: v-pre

# Secrets

- **Desktop:** secrets are encrypted with Electron `safeStorage`, which uses Windows DPAPI, the macOS Keychain or Linux Secret Service. The ciphertext is stored in `~/.aipstudio/secrets.json` and can only be decrypted by your OS account. If no secure backend is available, AI Protocol Studio refuses to store the secret rather than write plain text.
- **CLI/CI:** secrets come from the `APS_SECRET_*` environment variables (see [CI/CD](../test-runner/ci-cd.md)).
- **Workspace files** only reference secrets (`{{$secret.provider.openai.apiKey}}`). Saving a provider with a literal API key is rejected.
- **Exports** never contain secret values.

:::
