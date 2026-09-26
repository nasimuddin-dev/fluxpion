---
title: Install on Windows
description: Install AI Protocol Studio on Windows 10 or 11 with the installer or the portable app. Requirements, SmartScreen, per-user or all-users install, silent install and uninstalling.
---

# Install AI Protocol Studio on Windows

## Requirements

- Windows 10 or Windows 11, 64-bit (x64).
- About 400 MB of free disk space.
- Administrator rights only if you install for all users.

## Download

<Downloads only="windows" />

## Install

1. Double-click `AIProtocolStudio-<version>-windows-x64-setup.exe`.
2. The installer isn't code-signed yet, so Windows SmartScreen may show **"Windows protected your PC"**. Click **More info**, then **Run anyway**. Your browser may also ask whether to keep the file; choose **Keep**.
3. Choose who to install for:
   - **Only for me:** installs to `%LOCALAPPDATA%\Programs\AI Protocol Studio` without administrator rights.
   - **Anyone who uses this computer:** installs to `C:\Program Files\AI Protocol Studio`. Windows asks for administrator approval.
4. Optionally change the folder, then click **Install** and **Finish**.

The app gets a Start menu entry and a desktop shortcut named **AI Protocol Studio**, and appears under **Settings → Apps → Installed apps**.

## Portable version

`AIProtocolStudio-<version>-windows-x64-portable.exe` runs without installing. Put it anywhere, for example on a USB stick, and double-click it. It starts a little slower than the installed app because it unpacks itself on each launch.

## First launch

Open **AI Protocol Studio** from the Start menu. On first launch it creates a workspace called **My Workspace** in `%USERPROFILE%\.aipstudio\workspaces`. Continue with [your first request](/getting-started/first-request).

Secrets (tokens, API keys, secret variables) are encrypted with **Windows DPAPI**, tied to your Windows account.

## Silent install (IT administrators)

```powershell
.\AIProtocolStudio-<version>-windows-x64-setup.exe /S                 # current user
.\AIProtocolStudio-<version>-windows-x64-setup.exe /S /allusers       # all users (run elevated)
.\AIProtocolStudio-<version>-windows-x64-setup.exe /S /D=C:\Tools\APS  # custom folder (must be last)
```

## Updating

Download and run the newer installer. It upgrades in place and keeps your workspaces, settings and secrets.

## Uninstall

Use **Settings → Apps → Installed apps → AI Protocol Studio → Uninstall**. Your workspaces and settings in `%USERPROFILE%\.aipstudio` are kept; delete that folder to remove them too.
