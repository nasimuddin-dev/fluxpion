---
title: Install the CLI
description: Install the testpion command-line runner to run TestPion tests locally and in CI/CD.
---

# Install the CLI

The `testpion` CLI runs the same tests as the desktop app, using the same engine. Use it on CI servers and in scripts.

## Requirements

- Node.js 22.13 or newer (24+ recommended).

## Install from source

```bash
git clone https://github.com/nasimuddin-dev/testpion.git
cd testpion
npm ci
npm run build -w @testpion/core -w @testpion/cli
npm link -w @testpion/cli
testpion --help
```

In CI you can skip `npm link` and run `node packages/cli/bin/testpion.js` directly.

## Run tests

```bash
testpion test ./tests                                   # nearest workspace.json is used
testpion run -w ./my-workspace -e Staging --suite regression
```

Exit codes: `0` success · `1` test failure · `2` configuration error · `3` execution error.

See the [CLI reference](/cli/reference) and [CI/CD integration](/test-runner/ci-cd).
