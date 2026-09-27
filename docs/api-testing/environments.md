---
title: "Environments and variables"
description: "Variable scopes and precedence, secret variables, dynamic variables and production safeguards."
---

::: v-pre

# Environments and variables

## Precedence

`Global → Workspace → Environment → Collection → Request → Runtime`. Later scopes win. Runtime variables are set by scripts, `extract:` rules and CLI `--var key=value`.

## Built-in variables

`{{$uuid}}`, `{{$timestamp}}`, `{{$timestampMs}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomInt(1,10)}}`, `{{$randomEmail}}`, `{{$env.NAME}}` (process environment), `{{$secret.NAME}}` (secret store), and `{{workspaceDir}}`.

## Secrets

Mark a variable as **secret** (lock icon) and its value is encrypted in the OS credential store: Windows DPAPI, macOS Keychain or Linux Secret Service. The workspace file only records that the variable exists. In CI, supply the value as the environment variable `PROTOLENS_SECRET_ENV_<ENVID>_<KEY>`, for example `PROTOLENS_SECRET_ENV_STAGING_ACCESSTOKEN`.

## Quick look

Click the **eye** button next to the environment selector to see the active environment's and the global variables at a glance, like Postman's quick look. Each variable shows its initial value (what is saved) and its current value (what scripts set on this machine). *same* means no script has changed it. Secret and sensitive values are always shown as `••••••`. **Edit** opens the environment or the globals.

## Export

**Export** in an environment's toolbar writes it in Postman's environment format, which Postman and Newman read, and so does `protolens run-collection -e`. Secret variables are included by name only: the value is empty and the type is `secret`. The CLI equivalent is `protolens export-environment <name> -o file.json`.

## Production

Mark an environment as **production** to show a warning in the status bar and block load tests unless you opt in for that run.

:::
