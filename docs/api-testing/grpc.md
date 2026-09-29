---
title: "gRPC"
description: "Call gRPC services from .proto files: unary, server-streaming, client-streaming and bidirectional methods, metadata, TLS and deadlines."
---

::: v-pre

# gRPC

The **gRPC** view calls any gRPC service described by `.proto` files.

1. On **Proto files**, add the service's `.proto` file and the files it imports. Imports are matched by path, so give each file the path its import statement uses, such as `vet/v1/common.proto` (rename a file by editing its path). Google's well-known types (`google/protobuf/timestamp.proto` …) are built in.
2. Enter the server address, `host:port` (plaintext) or `grpcs://host:port` (TLS), and pick a method. Methods are listed as `package.Service/Method` with their kind (unary, server stream, client stream, bidi stream).
3. Write the request message as JSON, or click **Example** for a message with every field. For client-streaming and bidirectional methods, write a JSON **list**: one item per message sent.
4. Add **Metadata** (headers such as `authorization`) if the service needs it, then click **Invoke**.

The response shows the gRPC status (`0 OK`, `5 NOT_FOUND` …) with its details, the time, the response message as a tree, the response **Metadata** and **Trailers**.

## Streaming

Streamed responses appear **as they arrive**, one row per message with its arrival time. Click a row to see the message in full. **Stop** cancels the call and keeps the messages received so far (status `CANCELLED`).

## Messages

Messages use the JSON form of the proto fields, keeping their original names (`owner_id`):

- 64-bit integers are strings (`"id": "42"`), so large values stay exact.
- Enums are their names (`"species": "CAT"`).
- `google.protobuf.Timestamp` is `{ "seconds": "…", "nanos": 0 }`.
- Fields that aren't set come back with their default values.

Every value supports `{{variables}}` from the active environment, including the address and metadata. Keep tokens in [secret variables](./environments.md#secrets).

## Settings

- **Use TLS**: on for `grpcs://` addresses; turn it on for a TLS server given as `host:port`.
- **Deadline**: how long the call may take (default 30 s). A call that runs out returns `DEADLINE_EXCEEDED`.

## Try it

The demo servers include a gRPC service:

```bash
node examples/servers/demo-servers.mjs
```

Connect to `127.0.0.1:4014` with `examples/veterinary-workspace/protos/vet/v1/pets.proto` (name it `vet/v1/pets.proto`). Try `GetPet` with `{"id": "1"}` (or `"9"` for `NOT_FOUND`), `StreamVitals` for a live stream, and `CheckIn` with a list of pets.

## Limits

- Server reflection isn't supported yet: the `.proto` files are needed.
- mTLS (client certificates) isn't supported yet for gRPC.

:::
