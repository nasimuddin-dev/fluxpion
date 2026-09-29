---
title: "CI/CD integration"
description: "Run TestPion tests in GitHub Actions, GitLab CI, Azure DevOps and Jenkins."
---

::: v-pre

# CI/CD

```bash
testpion test ./tests                      # nearest workspace.json is used
testpion run --workspace veterinary-api --environment staging --suite regression
testpion run-collection "Veterinary API" -e Staging          # a collection, like Newman
```

### Coming from Newman

`run-collection` takes Postman collection and environment files directly and uses Newman's option names, so most pipelines only need the command changed:

```bash
# before
newman run api.postman_collection.json -e staging.postman_environment.json -d data.csv -n 2 --folder Smoke --reporters cli,junit
# after
testpion run-collection api.postman_collection.json -e staging.postman_environment.json -d data.csv -n 2 --folder Smoke -r console junit -o results
```

The other direction works too. If part of a team or pipeline stays on Newman, `testpion export "My API" -o api.postman_collection.json` and `testpion export-environment Staging -o staging.postman_environment.json` produce files Newman runs.

**Exit codes:** `0` success · `1` test failure · `2` configuration error · `3` execution error (e.g. cancelled).

**Secrets:** supply them through the CI secret store as environment variables:

- `TESTPION_SECRET_ENV_<ENV>_<KEY>` for environment secrets
- `TESTPION_SECRET_PROVIDER_<ID>_APIKEY` for provider keys
- or reference `{{$env.NAME}}` directly

## GitHub Actions

```yaml
- run: npx testpion test tests -e Staging -r console junit html -o test-results
  env:
    TESTPION_SECRET_PROVIDER_OPENAI_APIKEY: ${{ secrets.OPENAI_API_KEY }}
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: test-results, path: test-results }
```

To run a collection instead of test files:

```yaml
- run: npx testpion run-collection "Veterinary API" -e Staging -r console junit -o test-results
```

## GitLab CI

```yaml
api-tests:
  script: npx testpion test tests -o results
  artifacts:
    when: always
    reports: { junit: results/junit.xml }
```

For Azure DevOps and Jenkins, publish `junit.xml` with *PublishTestResults* or the `junit` step.

:::
