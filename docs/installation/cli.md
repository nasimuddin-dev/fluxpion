---
title: Install the CLI
description: Install the fluxpion command-line runner to run FluxPion tests locally and in CI/CD.
---

# Install the CLI

The `fluxpion` CLI runs the same tests as the desktop app, using the same engine. Use it on CI servers and in scripts.

## Requirements

- Node.js 22.13 or newer (24+ recommended).

## Install from source

```bash
git clone https://github.com/nasimuddin-dev/fluxpion.git
cd fluxpion
npm ci
npm run build -w @fluxpion/core -w @fluxpion/cli
npm link -w @fluxpion/cli
fluxpion --help
```

In CI you can skip `npm link` and run `node packages/cli/bin/fluxpion.js` directly.

## Run tests

```bash
fluxpion test ./tests                                   # nearest workspace.json is used
fluxpion run -w ./my-workspace -e Staging --suite regression
```

Exit codes: `0` success · `1` test failure · `2` configuration error · `3` execution error.

See the [CLI reference](/cli/reference) and [CI/CD integration](/test-runner/ci-cd).
