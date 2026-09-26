---
title: "CI/CD integration"
description: "Run Protolens tests in GitHub Actions, GitLab CI, Azure DevOps and Jenkins."
---

::: v-pre

# CI/CD

```bash
protolens test ./tests                      # nearest workspace.json is used
protolens run --workspace veterinary-api --environment staging --suite regression
```

**Exit codes:** `0` success · `1` test failure · `2` configuration error · `3` execution error (e.g. cancelled).

**Secrets:** supply them through the CI secret store as environment variables:

- `PROTOLENS_SECRET_ENV_<ENV>_<KEY>` for environment secrets
- `PROTOLENS_SECRET_PROVIDER_<ID>_APIKEY` for provider keys
- or reference `{{$env.NAME}}` directly

## GitHub Actions

```yaml
- run: npx protolens test tests -e Staging -r console junit html -o test-results
  env:
    PROTOLENS_SECRET_PROVIDER_OPENAI_APIKEY: ${{ secrets.OPENAI_API_KEY }}
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: test-results, path: test-results }
```

## GitLab CI

```yaml
api-tests:
  script: npx protolens test tests -o results
  artifacts:
    when: always
    reports: { junit: results/junit.xml }
```

For Azure DevOps and Jenkins, publish `junit.xml` with *PublishTestResults* or the `junit` step.

:::
