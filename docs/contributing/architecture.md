---
title: "Contributor architecture notes"
description: "Rules for contributors and AI coding agents working on the codebase."
---

::: v-pre

# Architecture notes for contributors

Follow the engineering rules in SRS §72. In particular:

- Keep protocol adapters independent of each other and keep UI state separate from execution state.
- Never block the renderer. Use bounded concurrency, stream data, and never hold unbounded payloads in memory.
- Never log secrets. Route every persisted artefact through the `Redactor`.
- Label AI-generated output (`source: 'ai-judge'`, *AI-generated suggestion* banners).

## Migrations

Workspace format changes need a new entry in `MIGRATIONS` (`packages/core/src/storage/workspace.ts`), a bump to `SCHEMA_VERSION`, and a test. Each migration upgrades exactly one version, and opening a newer format is refused rather than silently broken. The SQLite metadata schema has its own versioned migrations in `metastore.ts`.

:::
