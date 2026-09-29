---
title: "REST and HTTP testing"
description: "Build and test HTTP requests: methods, bodies, cookies, streaming, large responses, mTLS and proxies."
---

::: v-pre

# REST and HTTP

## Requests

- Any method, including custom ones.
- **Params, headers and cookies** use key/value tables, each row with its own toggle.
- **Cookie jar:** cookies set by responses are kept per workspace and sent with later matching requests. Open the **Cookies** dialog with the cookie button next to Send. See [Cookies](/api-testing/cookies).
- **Body types:** JSON, XML, text, HTML, form URL-encoded, multipart (text and file fields), and binary file. Files are streamed from disk.
- **Settings:** timeout, redirects, proxy, disabling TLS verification (development only), and client certificates (mTLS).

## Paste a request from the browser

In the browser's devtools, right-click a request on the **Network** tab, choose **Copy**, and pick any of:

- **Copy as cURL (bash)** or **Copy as cURL (cmd)**
- **Copy as fetch** or **Copy as fetch (Node.js)**
- **Copy as PowerShell** (`Invoke-WebRequest`, also `Invoke-RestMethod`)

Then paste it into FluxPion:

- **Into the URL bar:** the current tab is replaced with the pasted request.
- **Anywhere else in the REST view** (with no text field focused), for example right after opening a new tab with **Ctrl/Cmd+V**: an unchanged new tab is filled, otherwise the request opens in a new tab named after its method and path, such as `POST /v1/pets`.

The method, URL, query parameters, headers, cookies, body (JSON, form, multipart, XML or text), basic and bearer auth, and curl options such as `-k`, `-L`, `--proxy` and `--max-time` are all imported. HTTP/2 pseudo headers (`authority`, `method`, `path`, `scheme`) that PowerShell snippets include are dropped. Pasted secrets, such as an `Authorization` header or session cookie, are only in the unsaved tab: move them into a [secret variable](/api-testing/environments#secrets) before you save the request.

## Sidebar

The left sidebar of the REST view has three panes, like Postman's:

- **Collections:** the request tree, with a filter, **Import** and **New collection**. Right-click or use **⋯** on folders and requests for more actions.
- **Environments:** click an environment to make it active. **Edit** opens it, and **+** creates one.
- **History:** your recent HTTP requests grouped by day, with a filter. Click one to open it in a new tab.

The sidebar remembers the pane you last used.

## Tabs and history

Each request opens in a tab. A dot on a tab means it has unsaved changes.

When more tabs are open than fit, the tab bar doesn't scroll. It shows your pinned tabs and the tabs you used most recently, and a **+N** button on the right lists the others (as in Postman or VS Code). Pick one from the list to bring it into the tab bar; the least recently used tab moves into the list. The list also has **Close N hidden tabs**. Right-click a tab (or middle-click to close it) for:

- **Pin tab:** pinned tabs move to the front, show a pin, have no close button, and are kept by the bulk close actions. Unpin from the same menu.
- **Duplicate tab:** an unsaved copy of the request, opened next to it.
- **Close tab**, **Close other tabs**, **Close tabs to the right**, **Close all tabs:** you are asked once if any of the closed tabs has unsaved changes.

Open tabs, including pins, are restored when the app starts. You can close every tab: the editor then shows **New request** and **Describe with AI**, and stays empty after a restart until you open something.

**History** lists every request you sent, newest first, grouped by day (*Today*, *Yesterday*, weekday, then date). Search by name, URL, method or status, filter by kind, and double-click an entry (or click **Open**) to open it in a new tab. History stores redacted request metadata only.

## Responses

The status, duration, size, headers, cookies and a timeline (prepare → TTFB → download) are always shown. **Save as example** keeps the response with the request (see [Examples](/api-testing/collections#examples)). For the body:

- **Pretty** is a virtualised JSON tree. Click a key to copy its JSONPath.
- **Raw** is a virtualised text view with search.
- **Preview** renders HTML in a sandboxed frame.

The full body is streamed to `payloads/` on disk. The viewer only holds a preview, 2 MB by default and configurable in Settings. Larger bodies show a *truncated* badge; **Save response** exports the complete file. Streaming responses (`text/event-stream`) appear incrementally on the **Stream** tab.

## Scripts

Pre-request and post-response scripts use the **Postman `pm` API**, so scripts from imported Postman collections run unchanged. They run in a [sandbox](../security/privacy.md#script-sandbox) without file or network access. The **Snippets** list next to the editor inserts common scripts, and the editor autocompletes `pm.`.

Pre-request:

```js
pm.variables.set('nonce', pm.uuid());
const sig = CryptoJS.HmacSHA256(pm.request.body.toString(), pm.environment.get('secret')).toString(CryptoJS.enc.Base64);
pm.request.headers.upsert({ key: 'X-Signature', value: sig });
```

Post-response:

```js
pm.test('Status code is 200', () => pm.response.to.have.status(200));
pm.test('Returns patients', () => {
  const body = pm.response.json();
  pm.expect(body.items).to.be.an('array').that.is.not.empty;
  pm.expect(body.items[0]).to.have.property('species');
});
pm.environment.set('patientId', pm.response.json().items[0].id);
```

### Supported API

| Area | API |
|---|---|
| Tests | `pm.test`, chai-style `pm.expect(…).to.…` (`equal`, `eql`, `deep`, `a`/`an`, `include`, `property`, `lengthOf`, `above`/`below`, `oneOf`, `keys`, `match`, `not`, `true`/`false`/`null`/`ok`/`empty` …), legacy `tests["name"] = bool` |
| Response | `pm.response.code`, `.status`, `.responseTime`, `.headers.get()`, `.json()`, `.text()`, `pm.response.to.have.status/header/body/jsonBody`, `pm.response.to.be.ok/success/error/json`, legacy `responseCode`, `responseBody` |
| Request | `pm.request.method`, `.url.toString()/update()`, `.headers.add/upsert/remove/get`, `.body.toString()/update()` |
| Variables | `pm.variables`, `pm.environment`, `pm.collectionVariables`, `pm.globals` (`get/set/unset/has/clear/toObject/replaceIn`), `pm.iterationData` |
| Other | `pm.info`, `pm.cookies`, `pm.cookies.jar()` (`get`, `getAll`, `set`, `unset`, `clear`), `pm.execution.setNextRequest`, `pm.sendRequest`, `postman.setNextRequest`, `postman.setEnvironmentVariable`, `CryptoJS` (hashes, HMAC, Base64/Hex/Utf8), `btoa`/`atob`, `require('crypto-js')`, `console.log` |

**`pm.sendRequest`** sends another HTTP request from a pre-request or test script, for example to fetch a token first:

```js
pm.sendRequest({
  url: pm.variables.replaceIn("{{baseUrl}}/auth/token"),
  method: "POST",
  header: { "Content-Type": "application/json" },
  body: { mode: "raw", raw: JSON.stringify({ client_id: pm.environment.get("clientId") }) }
}, (err, res) => {
  if (err) return console.error(err.message);
  pm.environment.set("accessToken", res.json().access_token);
  pm.request.headers.upsert({ key: "Authorization", value: "Bearer " + res.json().access_token });
});
```

- The request is a URL string or a Postman request object (`url`, `method`, `header` as a list or map, `body` with `mode: "raw"` or `"urlencoded"`). As in Postman, `{{variables}}` are not resolved automatically: use `pm.variables.replaceIn()`.
- The response has `code`, `status`, `responseTime`, `headers`, `json()` and `text()`. On a network error, the callback gets `err` and `null`.
- Requests share the run's cookie jar, time out like other requests, and appear in the [Console](#console) under the script's request, whether the request was sent from a tab or by a run (they are also recorded as `sentRequests` in the run's results).
- **How it works:** the sandbox is synchronous, so the script runs, its requests are sent, then the script runs again from the start with the responses, and callbacks run immediately. Only the last run's variables, tests and logs count. So a request made inside a callback also has its callback run inside, before later callbacks. Keep scripts deterministic around `pm.sendRequest` (avoid a random URL per run). A script may send at most 20 requests.

**Current values:** values set with `pm.environment.set`, `pm.collectionVariables.set` or `pm.globals.set` are kept on this machine as *current values* and override the stored values. They're never written to workspace files. Sensitive ones (tokens, passwords, secret variables) are encrypted. You can see and reset them under **Environments**.

## AI help

With an assistant model set in **Settings → AI Assistant** (a local model works offline), the request builder can draft work for you. Everything the AI produces is labelled and shown to you first. Nothing is sent or run on its own.

- **Describe a request** (sparkles button next to Send): write what you want in plain words, for example *create a patient named Biscuit, a dog, owned by customer 123*. A new tab opens with the method, URL, headers and body filled in. The assistant only sees the **names** of your variables, so it writes `{{baseUrl}}` and `{{accessToken}}` instead of real values.
- **Generate tests** (above a response): the assistant writes `pm.test(...)` checks for the response's status, fields, types and timing and appends them to the Post-response script, headed by an *AI-generated* comment. Send again to run them. Imports the sandbox doesn't support are removed.
- **Explain** (above a 4xx or 5xx response): opens the assistant with what the error means, the likely cause and how to fix the request.
- **Suggest assertions** proposes FluxPion checks (YAML) for the response.

Context sent to the model is redacted first (sensitive headers, fields and secret values are masked) and trimmed to the first few thousand characters of the body.

## Console

The **Console** is Postman's console: a log of every request with its script output. Open it with **Console** in the status bar or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> (<kbd>⌘</kbd>+<kbd>⌥</kbd>+<kbd>C</kbd> on macOS). It shares the bottom panel with the application **Logs**.

- Each line shows the time, method, URL, status, duration and size. GraphQL operations sent from the GraphQL view are marked **GraphQL** (their request shows the query and variables). Requests from runs (the test runner and the Collection Runner) are marked **run**, and failed checks, including GraphQL `errors`, are counted.
- `console.log`, `console.info`, `console.warn` and `console.error` output from pre-request and test scripts appears under its request, marked `pre ›` or `test ›`.
- Click a request sent from a tab to expand it and see the request and response headers and bodies (up to 16,000 characters each).
- **All / Errors / With logs** and the filter box narrow the list. The trash button clears it. The console keeps the last 500 requests until the app closes and is never written to disk.
- Everything is redacted before it reaches the console: sensitive headers, sensitive JSON fields, known secret values, and values you typed into sensitive headers or body fields, even when a server echoes them back.

See also [authentication](./authentication.md), [environments](./environments.md) and [collections](./collections.md).

:::
