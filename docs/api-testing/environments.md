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
- In scripts, `pm.environment.get('`, `pm.variables.set('`, `pm.globals.has('` and the like suggest the names of that scope's variables.
- Header values also suggest common values (e.g. `Content-Type: application/json`, `Authorization: Bearer {{accessToken}}`).

Dynamic values (`{{$uuid}}`, `{{$timestamp}}` …) and `{{$env.NAME}}` count as defined.

## Find usages and rename

**Usages** in an environment's toolbar (or **Find variable usages** in the command palette, Ctrl+K) shows where a variable is used and defined: `{{name}}` in URLs, parameters, headers, bodies, auth and assertions, `pm.environment.get('name')` and the like in scripts, environments, collection, folder and workspace variables, and test files. Click a request to open it.

**Rename everywhere** changes all of them at once and refuses a name that's already defined. A secret variable keeps its value: it moves to the new name in the OS secret store. Open request tabs with unsaved edits keep the old name until you reload them.

```bash
testpion vars usages accessToken -w my-workspace
testpion vars rename token accessToken -w my-workspace
testpion vars unused -w my-workspace          # variables nothing reads
```

Under an environment's variables, *Not used anywhere in the workspace* lists the ones nothing reads (no `{{name}}` in requests, saved items, MCP servers, test files or other variables, and no script `get`); check one with **Usages** before deleting it. AI agents use the MCP tools `variable_usages`, `rename_variable` and `unused_variables`.

## Built-in variables

`{{$env.NAME}}` (an OS environment variable; in the app only the names listed in **Settings ▸ Privacy ▸ OS environment variables requests may read**, so a shared or imported collection can't read your keys; the CLI reads all of them), `{{$secret.NAME}}` (secret store) and `{{workspaceDir}}`, plus **dynamic variables** that give a new value every time they're used. Their names are Postman's, so imported Postman collections send the same kind of values. Type `{{$` to pick one; the list says what each gives.

| Kind | Variables |
| --- | --- |
| IDs and time | `$guid` / `$uuid` / `$randomUUID`, `$timestamp` (seconds), `$timestampMs`, `$isoTimestamp`, `$randomDateFuture`, `$randomDatePast`, `$randomDateRecent`, `$randomWeekday`, `$randomMonth` |
| Numbers | `$randomInt` (0–1000), `$randomInt(min,max)`, `$randomBoolean`, `$randomPrice`, `$randomBankAccount`, `$randomSemver`, `$randomLatitude`, `$randomLongitude` |
| People | `$randomFirstName`, `$randomLastName`, `$randomFullName`, `$randomNamePrefix`, `$randomNameSuffix`, `$randomJobTitle`, `$randomJobArea`, `$randomUserName`, `$randomPassword`, `$randomPhoneNumber`, `$randomPhoneNumberExt` |
| Places | `$randomCity`, `$randomCountry`, `$randomCountryCode`, `$randomStreetName`, `$randomStreetAddress`, `$randomLocale` |
| Internet | `$randomEmail`, `$randomExampleEmail`, `$randomUrl`, `$randomDomainName`, `$randomDomainWord`, `$randomDomainSuffix`, `$randomIP`, `$randomIPV6`, `$randomMACAddress`, `$randomProtocol`, `$randomUserAgent`, `$randomImageUrl`, `$randomAvatarImage` |
| Business | `$randomCompanyName`, `$randomCompanySuffix`, `$randomDepartment`, `$randomProduct`, `$randomProductName`, `$randomProductAdjective`, `$randomProductMaterial`, `$randomCatchPhrase`, `$randomCurrencyCode`, `$randomCurrencyName`, `$randomCurrencySymbol` |
| Text | `$randomWord`, `$randomWords`, `$randomLoremWord`, `$randomLoremWords`, `$randomLoremSentence`, `$randomLoremSentences`, `$randomLoremParagraph`, `$randomLoremSlug`, `$randomAbbreviation`, `$randomAlphaNumeric`, `$randomColor`, `$randomHexColor` |
| Files | `$randomFileName`, `$randomFileExt`, `$randomFileType`, `$randomMimeType` |

The values are made up: emails use `example.test` / `example.com`, phone numbers the fictional 555 range, domains `*.example.*`.

## Secrets

Mark a variable as **secret** (lock icon) and its value is encrypted in the OS credential store: Windows DPAPI, macOS Keychain or Linux Secret Service. The workspace file only records that the variable exists. In CI, supply the value as the environment variable `TESTPION_SECRET_ENV_<ENVID>_<KEY>`, for example `TESTPION_SECRET_ENV_STAGING_ACCESSTOKEN`.

## All variable scopes in one place

The **Environments** view has a tab for each scope: **Environments**, **Collection variables**, **Workspace variables** and **Global variables**. Collection variables (an imported Postman collection keeps its variables there) are listed per collection: pick one on the left, edit its variables, **Save**; they are the same as in the collection's own settings. A scope with no variables yet says what it is for and, when your collections have variables, links to them.

## See or change one variable

Wherever a `{{variable}}` appears (the URL bar, params, headers, auth fields, the body and other code editors, test files), **double-click** it to see its value and where it comes from (environment, collection, workspace, dynamic). In the URL bar, params and headers a single click is enough. A variable of the active environment can be edited right there, and one that isn't defined yet can be added to it; **Copy** copies the value (secret values are never shown).

## Quick look: every variable at once

Click the **eye** button next to the environment selector to see every variable the request on screen can use, in the order they win: its **collection's** variables, the active **environment's**, the **workspace's** and the **globals**. Each shows its initial value (what is saved) and its current value (what scripts set on this machine; *same* when no script changed it). A variable that a scope above also sets is shown faded as *(overridden)*. Type in the filter to find a variable by name or value in large collections; **Edit** opens that scope's variables. Secret and sensitive values are never shown.

From a variable's popover, the button next to **Copy** goes to where that variable is set (**Collection variables**, **Workspace variables**, **Globals** or **Environments**), and **All** opens the quick look.

## Compare

**Compare** (at the top of an environment) shows two environments side by side. Differences come first:

- variables missing on one side;
- different values;
- variables that are disabled on one side;
- secrets that are set on one side only.

Use it when a request works on Staging but fails on Production. Secret and sensitive-looking values (tokens, passwords, keys) are masked; secrets are compared by their stored values without being shown.

From the terminal, `testpion env diff Staging Production -w my-workspace` lists the differences and exits with 1 when there are any. Add `--values` to see non-secret values, `--all` to include the variables that are the same, and `--json` for scripts. AI agents get the `compare_environments` tool, which returns statuses, never values.

**Matrix** shows every variable across all environments at once: *set*, *empty*, *missing* or *off* in each, with a lock on secrets, the incomplete ones first. It catches the variable you added to Development and forgot in Staging. `testpion env matrix` prints it (exit 1 when a variable is incomplete somewhere) and agents use `environment_matrix`; neither shows values.

## Import a .env file

**Import** (File menu, or Collections) also takes `.env` files: every `KEY=value` line becomes a variable of a new environment named after the file (`.env.staging` and `staging.env` become *staging*). Quotes, `export`, `#` comments and `\n` in double quotes work. Keys that look like secrets (`API_KEY`, `DB_PASSWORD`, `TOKEN` …) become secret variables: the app keeps their values in the OS secret store, never in the environment file, and the CLI (`testpion import .env.staging -w <workspace>`) lists them for you to set.

## Export

**Export** in an environment's toolbar writes it as a `.env` file or in Postman's environment format. In a `.env` file, secret variables are listed with an empty value. The Postman format, which Postman and Newman read, and so does `testpion run-collection -e`. Secret variables are included by name only: the value is empty and the type is `secret`. The CLI equivalent is `testpion export-environment <name> -o file.json`.

## Production

Mark an environment as **production** to show a warning in the status bar and block load tests unless you opt in for that run.

With a production environment active, sending a request that can change data (anything but GET, HEAD and OPTIONS) from the REST view asks first. **Send and don't ask again** stops asking for that environment until you restart the app.

:::
