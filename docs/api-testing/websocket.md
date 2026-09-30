---
title: "WebSocket"
description: "Connect to WebSocket and Socket.IO servers, send messages and events (with acknowledgements), save connections in folders, and read clear connection errors."
---

::: v-pre

# WebSocket

The **WebSocket** view connects to a `ws://` or `wss://` server, sends messages and shows every message in both directions.

1. Enter the URL (variables such as `{{wsUrl}}` resolve from the active environment) and, if the server expects them, **Subprotocols** (comma separated) and **Handshake headers** (e.g. `Authorization`).
2. Click **Connect**. Cookies from the [cookie jar](./cookies.md) for the URL's domain are sent with the handshake.
3. Write a message (JSON or any text) and click **Send**.

The message log lists sent (↗), received (↙) and connection (ⓘ) messages with their time. Filter it, and click a message to see it in full (JSON as a tree). Connecting, sending and closing also appear in the [console](./rest.md#console).

## Socket.IO

Switch the protocol to **Socket.IO** to talk to a [Socket.IO](https://socket.io) server:

- The URL is the server and the namespace, e.g. `http://localhost:3000/chat` (`https://` for TLS). Set the **path** if the server doesn't use `/socket.io`.
- **Auth** is the handshake's auth payload (JSON), e.g. `{ "token": "{{accessToken}}" }`; handshake headers work too.
- On **Emit**, give the **event name** and its arguments as JSON (a JSON list sends several arguments). Tick **Acknowledgement** to wait for the server's reply (callback); it appears as `ack <event>`.
- Every event the server sends appears with its name. A refused connection shows the server's reason (e.g. `not authorized`).

The demo servers include a Socket.IO namespace: `http://127.0.0.1:4015/chat` (emit `say`; the server broadcasts `said` and acknowledges).

## Saved connections

The **Saved connections** list keeps connections (URL, subprotocols, handshake headers and the message) in folders:

- **Save** stores the current connection, or saves the changes to the one you opened (*Save\**).
- Create folders with the folder button above the list. Move a connection with its `⋯` / right-click menu (*Move to folder…*) or by dragging it onto a folder.
- Rename, duplicate and delete from the same menu.

Saved connections live in the workspace (`library/websocket.json`). Use `{{variables}}` for tokens in headers, and keep the values in [secret variables](./environments.md#secrets).

## WebSocket tests

A test file with `type: websocket` connects, sends messages in order, listens for `waitMs`, and closes. The assertions run on:

- `$.received`: each message the server sent, parsed as JSON when it is JSON. With Socket.IO, each item is `{ event, data }`.
- `$.messages`: everything, with direction and time.
- The plain text of the received messages, for `contains` without a path.

A test that can't connect is an error that gives the reason.

```yaml
name: Echo server replies
type: websocket              # socketio for Socket.IO (or an http(s):// URL)
url: "{{wsEcho}}"
send:
  - hello                    # a text frame
  - { type: ping, id: 1 }    # objects are sent as JSON
waitMs: 1500
assertions:
  - { type: status, expected: 101 }            # connected (Switching Protocols)
  - { type: equals, path: "$.received[0]", expected: hello }
  - { type: equals, path: "$.received[1].type", expected: ping }
```

For Socket.IO, `send` items are `{ event, args, ack }`. Add `path:` if the server doesn't use `/socket.io`, and `auth:` for a handshake payload. The same exchange works from the terminal with [`testpion ws`](../cli/reference.md), and for AI agents with the `realtime_exchange` MCP tool.

## When a connection fails

The reason is shown in the message log, with what to try:

| Message | What it means |
|---|---|
| *Can't find the server "…" (its name doesn't resolve)* | The host name doesn't exist (a typo, or a service that was retired). |
| *Nothing is listening on host:port (connection refused)* | The server isn't running, or the port is wrong. |
| *The server answered HTTP 401 / 404 … instead of opening a WebSocket* | The URL isn't a WebSocket endpoint, or the server wants credentials (add them under **Handshake headers**). |
| *… doesn't use TLS on this port, but the URL starts with wss://* | Use `ws://`. |

The demo servers include a WebSocket echo server: `node examples/servers/demo-servers.mjs`, then connect to `ws://127.0.0.1:4013`.

:::
