---
title: "Installation"
description: "Install the Protolens desktop app on Windows, macOS or Linux, or the protolens CLI."
---

# Installation

## Desktop app

Download the installer for your system from the [download page](/download), then follow the guide:

- [Windows](/installation/windows) — installer or portable `.exe`
- [macOS](/installation/macos) — `.dmg` for Apple Silicon and Intel
- [Linux](/installation/linux) — AppImage, `.deb` or `.rpm`

## Command-line runner

For CI servers and scripts, install the [`protolens` CLI](/installation/cli).

## Try it with the demo servers

The repository includes local demo servers (REST, GraphQL, an OpenAI-compatible mock LLM, WebSocket and an MCP server) and an example workspace with 22 tests:

```bash
git clone https://github.com/nasimuddin-dev/protolens.git
cd protolens && npm ci && npm run build
node examples/servers/demo-servers.mjs
```

Open the `examples/veterinary-workspace` folder from the workspace menu (**Open folder…**), then continue with [your first request](/getting-started/first-request).

## Where data lives

| Item | Location |
|---|---|
| Settings, logs, encrypted secrets | `~/.protolens/` (override with `PROTOLENS_HOME`) |
| Workspaces | `~/.protolens/workspaces/<name>/`, or any folder you open (for example inside a git repo) |
