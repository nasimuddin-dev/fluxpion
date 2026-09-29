---
title: "Workspaces"
description: "Create, switch, rename, duplicate, export and delete FluxPion workspaces, from the app, the CLI or an AI agent."
---

# Workspaces

A workspace is a folder that holds your collections, environments, tests, datasets, providers and MCP servers as plain JSON and YAML files, so it can live in git. Secret values are never in these files: they stay in your OS credential store.

## The workspace switcher

Click the workspace name at the top left (or right-click it) to open the switcher.

- **Find a workspace:** type to filter by name or folder. **Enter** opens the first match.
- Each workspace shows its folder. The open one is marked **current**.
- Click a workspace to switch to it.
- **New**, **Open folder** and **Import** are at the bottom. **Open folder** adds an existing workspace folder, such as a git checkout. **Import** takes a FluxPion workspace export (it opens as a new workspace), or a Postman collection or environment, OpenAPI or HAR file (added to the open workspace).

### Workspace actions

Hover a workspace and click **⋯**, or right-click it:

| Action | What it does |
|---|---|
| **Open** | Switch to the workspace. |
| **Rename…** | Rename it. This works for any workspace, not only the open one. |
| **Duplicate…** | Copy collections, environments, tests and settings into a new workspace and open it. Run history, traces and secret values are not copied. |
| **Show in folder** | Open the workspace folder in your file manager. |
| **Export…** | Save a workspace export file (secret values are never exported). |
| **Delete…** | See below. |

### Deleting a workspace

**Delete…** opens a dialog that shows the workspace's folder and what it holds (collections, environments, test files). Type the workspace name to confirm; the case doesn't matter.

- A workspace FluxPion created (in its data folder) is **deleted from disk**, with its run history and traces. This can't be undone, so export it first if you may need it.
- A folder you opened yourself (for example a git checkout) is only **removed from the list**. Its files stay, and **Open folder** brings it back.
- You can delete the open workspace: FluxPion switches to another one first. Your only workspace can't be deleted; create another one first.

## From the CLI and AI agents

```bash
fluxpion workspace list --json
fluxpion workspace create "Checkout API" --path ./api-tests    # a workspace inside a repo
fluxpion workspace rename "Checkout API" "Checkout API v2" --json
fluxpion workspace export "Checkout API v2" -o checkout.apsworkspace.json
fluxpion workspace delete "Checkout API v2" --yes --json       # --yes is required
```

`workspace delete` refuses to run without `--yes` and says what would be deleted. The [MCP server](/ai-testing/mcp-server) gives agents one workspace's collections, requests and environments; creating and deleting workspaces stays with you and the CLI.
