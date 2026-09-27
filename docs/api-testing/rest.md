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
| Other | `pm.info`, `pm.cookies`, `pm.cookies.jar()` (`get`, `getAll`, `set`, `unset`, `clear`), `pm.execution.setNextRequest`, `postman.setNextRequest`, `postman.setEnvironmentVariable`, `CryptoJS` (hashes, HMAC, Base64/Hex/Utf8), `btoa`/`atob`, `require('crypto-js')`, `console.log` |

`pm.sendRequest` isn't supported yet; chain requests in a collection run or use `dependsOn` + `extract` in YAML tests.

**Current values:** values set with `pm.environment.set`, `pm.collectionVariables.set` or `pm.globals.set` are kept on this machine as *current values* and override the stored values. They're never written to workspace files. Sensitive ones (tokens, passwords, secret variables) are encrypted. You can see and reset them under **Environments**.

See also [authentication](./authentication.md), [environments](./environments.md) and [collections](./collections.md).

:::
