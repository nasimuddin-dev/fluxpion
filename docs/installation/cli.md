---
title: Install the CLI
description: Install the aipstudio command-line runner to run AI Protocol Studio tests locally and in CI/CD.
---

# Install the CLI

The `aipstudio` CLI runs the same tests as the desktop app, using the same engine. Use it on CI servers and in scripts.

## Requirements

- Node.js 22.13 or newer (24+ recommended).

## Install from source

```bash
git clone https://github.com/nasimuddin-dev/protolens.git
cd protolens
npm ci
npm run build -w @aps/core -w @aps/cli
npm link -w @aps/cli
aipstudio --help
```

In CI you can skip `npm link` and run `node packages/cli/bin/aipstudio.js` directly.

## Run tests

```bash
aipstudio test ./tests                                   # nearest workspace.json is used
aipstudio run -w ./my-workspace -e Staging --suite regression
```

Exit codes: `0` success · `1` test failure · `2` configuration error · `3` execution error.

See the [CLI reference](/cli/reference) and [CI/CD integration](/test-runner/ci-cd).
