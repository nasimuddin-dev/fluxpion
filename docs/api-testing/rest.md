---
title: "REST and HTTP testing"
description: "Build and test HTTP requests: methods, bodies, cookies, streaming, large responses, mTLS and proxies."
---

::: v-pre

# REST and HTTP

## Requests

- Any method, including custom ones.
- **Params, headers and cookies** use key/value tables, each row with its own toggle.
- **Body types:** JSON, XML, text, HTML, form URL-encoded, multipart (text and file fields), and binary file. Files are streamed from disk.
- **Settings:** timeout, redirects, proxy, disabling TLS verification (development only), and client certificates (mTLS).

## Responses

The status, duration, size, headers, cookies and a timeline (prepare → TTFB → download) are always shown. For the body:

- **Pretty** is a virtualised JSON tree. Click a key to copy its JSONPath.
- **Raw** is a virtualised text view with search.
- **Preview** renders HTML in a sandboxed frame.

The full body is streamed to `payloads/` on disk. The viewer only holds a preview, 2 MB by default and configurable in Settings. Larger bodies show a *truncated* badge; **Save response** exports the complete file. Streaming responses (`text/event-stream`) appear incrementally on the **Stream** tab.

## Scripts

Pre-request and test scripts run in a [sandbox](../security/privacy.md#script-sandbox):

```js
aps.variables.set('nonce', aps.uuid());
aps.request.headers.push({ key: 'x-signature', value: aps.crypto.hmacSha256('key', aps.request.body) });
```

```js
const body = aps.response.json();
aps.test('has patients', () => aps.expect(body.items.length).toBeGreaterThan(0));
aps.variables.set('patientId', body.items[0].id);
```

See also [authentication](./authentication.md), [environments](./environments.md) and [collections](./collections.md).

:::
