---
title: "Collections"
description: "Organise requests in collections and folders with variables, inherited auth, scripts, import/export and versioning."
---

::: v-pre

# Collections

Collections hold folders and requests (REST and GraphQL), plus collection-level variables, auth (inherited by requests set to *Inherit*), and pre-request and test scripts.

Each collection is a versioned JSON file under `collections/` in the workspace, and its `version` increments on every save. Commit it to git for review and history.

## Import

**Import** accepts:

- OpenAPI 3 / Swagger 2 (JSON or YAML). Tags become folders, parameters and example bodies are generated, and security schemes map to auth.
- Postman v2.1 collections (including scripts) and environments.
- HAR files.
- AI Protocol Studio collections and workspace exports.

The CLI can import too: `aipstudio import openapi.yaml -w my-workspace`.

:::
