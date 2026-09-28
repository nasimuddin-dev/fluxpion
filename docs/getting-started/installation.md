---
title: "Installation"
description: "Install the FluxPion desktop app on Windows, macOS or Linux, or the fluxpion CLI."
---

# Installation

## Desktop app

Download the installer for your system from the [download page](/download), then follow the guide:

- [Windows](/installation/windows) — installer or portable `.exe`
- [macOS](/installation/macos) — `.dmg` for Apple Silicon and Intel
- [Linux](/installation/linux) — AppImage, `.deb` or `.rpm`

## Command-line runner

For CI servers and scripts, install the [`fluxpion` CLI](/installation/cli).

## Try it with the demo servers

The repository includes local demo servers (REST, GraphQL, an OpenAI-compatible mock LLM, WebSocket and an MCP server) and an example workspace with 22 tests:

```bash
git clone https://github.com/nasimuddin-dev/fluxpion.git
cd fluxpion && npm ci && npm run build
node examples/servers/demo-servers.mjs
```

Open the `examples/veterinary-workspace` folder from the workspace menu (**Open folder…**), then continue with [your first request](/getting-started/first-request).

## Where data lives

| Item | Location |
|---|---|
| Settings, logs, encrypted secrets | `~/.fluxpion/` (override with `FLUXPION_HOME`) |
| Workspaces | `~/.fluxpion/workspaces/<name>/`, or any folder you open (for example inside a git repo) |
