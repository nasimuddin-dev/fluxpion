---
title: Install on macOS
description: Install Protolens on macOS 12 or later (Apple Silicon or Intel) from a .dmg, open it past Gatekeeper, and uninstall it.
---

# Install Protolens on macOS

## Requirements

- macOS 12 Monterey or later.
- An Apple Silicon (M-series) or Intel Mac. Apple menu → **About This Mac** shows which one you have.

## Download

<Downloads only="macos" />

## Install

1. Open the downloaded `.dmg`.
2. Drag **Protolens** into the **Applications** folder.
3. Eject the disk image.

## First launch

The app isn't notarized by Apple yet, so macOS blocks the first launch:

1. Open **Applications**, **right-click** (or Control-click) **Protolens** and choose **Open**.
2. Click **Open** in the dialog. macOS remembers this choice.

If macOS says the app **"is damaged and can't be opened"**, that's the quarantine flag on an unsigned download. Clear it in Terminal and open the app again:

```bash
xattr -dr com.apple.quarantine "/Applications/Protolens.app"
```

On macOS 15 and later you may instead need to go to **System Settings → Privacy & Security** and click **Open Anyway** after the first attempt.

Secrets are stored in the **macOS Keychain**. The first time the app saves a secret, macOS may ask you to allow access to the Keychain; choose **Always Allow**.

Continue with [your first request](/getting-started/first-request).

## Updating

Download the new `.dmg` and replace the app in **Applications**. Your workspaces and settings in `~/.protolens` are kept.

## Uninstall

Drag **Protolens** from **Applications** to the Trash. To remove your data too, delete `~/.protolens` and `~/Library/Application Support/Protolens`.
