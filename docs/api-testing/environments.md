---
title: "Environments and variables"
description: "Variable scopes and precedence, secret variables, dynamic variables and production safeguards."
---

::: v-pre

# Environments and variables

## Precedence

`Global → Workspace → Environment → Collection → Request → Runtime`. Later scopes win. Runtime variables are set by scripts, `extract:` rules and CLI `--var key=value`.

## Order

In the **Environments** view, drag an environment up or down the list (or focus it and press **Alt+↑** / **Alt+↓**) to change its position. The order is saved in the workspace (an `order` field in each environment file) and used everywhere environments are listed: the environment picker in the top bar, the Home view, the REST sidebar and the collection runner. Environments without a position, such as newly created ones, come last.

## Typing variables

Everywhere you can write a value, `{{variables}}` help you:

- **Autocomplete:** type `{{` in the URL bar, a header, param or form value, a body, a script, a message or a prompt to pick a variable. The list shows each one's value and where it comes from (environment, collection, workspace, global); secret values stay hidden.
- **Colour:** a variable that resolves is **blue**; one that isn't defined anywhere is **red** (with a wavy underline in code editors), so a typo shows before you send.
- **Hover** a variable to see its value and scope, or that it isn't defined.
- Header values also suggest common values (e.g. `Content-Type: application/json`, `Authorization: Bearer {{accessToken}}`).

Dynamic values (`{{$uuid}}`, `{{$timestamp}}` …) and `{{$env.NAME}}` count as defined.

## Built-in variables

`{{$uuid}}`, `{{$timestamp}}`, `{{$timestampMs}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomInt(1,10)}}`, `{{$randomEmail}}`, `{{$env.NAME}}` (process environment), `{{$secret.NAME}}` (secret store), and `{{workspaceDir}}`.

## Secrets

Mark a variable as **secret** (lock icon) and its value is encrypted in the OS credential store: Windows DPAPI, macOS Keychain or Linux Secret Service. The workspace file only records that the variable exists. In CI, supply the value as the environment variable `TESTPION_SECRET_ENV_<ENVID>_<KEY>`, for example `TESTPION_SECRET_ENV_STAGING_ACCESSTOKEN`.

## Quick look

Click the **eye** button next to the environment selector to see the active environment's and the global variables at a glance, like Postman's quick look. Each variable shows its initial value (what is saved) and its current value (what scripts set on this machine). *same* means no script has changed it. Secret and sensitive values are always shown as `••••••`. **Edit** opens the environment or the globals.

## Compare

**Compare** (at the top of an environment) shows two environments side by side. Differences come first:

- variables missing on one side;
- different values;
- variables that are disabled on one side;
- secrets that are set on one side only.

Use it when a request works on Staging but fails on Production. Secret and sensitive-looking values (tokens, passwords, keys) are masked; secrets are compared by their stored values without being shown.

From the terminal, `testpion env diff Staging Production -w my-workspace` lists the differences and exits with 1 when there are any. Add `--values` to see non-secret values, `--all` to include the variables that are the same, and `--json` for scripts. AI agents get the `compare_environments` tool, which returns statuses, never values.

## Export

**Export** in an environment's toolbar writes it in Postman's environment format, which Postman and Newman read, and so does `testpion run-collection -e`. Secret variables are included by name only: the value is empty and the type is `secret`. The CLI equivalent is `testpion export-environment <name> -o file.json`.

## Production

Mark an environment as **production** to show a warning in the status bar and block load tests unless you opt in for that run.

:::
