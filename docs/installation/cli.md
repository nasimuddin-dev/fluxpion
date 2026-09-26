---
title: Install the CLI
description: Install the protolens command-line runner to run Protolens tests locally and in CI/CD.
---

# Install the CLI

The `protolens` CLI runs the same tests as the desktop app, using the same engine. Use it on CI servers and in scripts.

## Requirements

- Node.js 22.13 or newer (24+ recommended).

## Install from source

```bash
git clone https://github.com/nasimuddin-dev/protolens.git
cd protolens
npm ci
npm run build -w @protolens/core -w @protolens/cli
npm link -w @protolens/cli
protolens --help
```

In CI you can skip `npm link` and run `node packages/cli/bin/protolens.js` directly.

## Run tests

```bash
protolens test ./tests                                   # nearest workspace.json is used
protolens run -w ./my-workspace -e Staging --suite regression
```

Exit codes: `0` success · `1` test failure · `2` configuration error · `3` execution error.

See the [CLI reference](/cli/reference) and [CI/CD integration](/test-runner/ci-cd).
