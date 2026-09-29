---
title: Install on Linux
description: Install TestPion on Linux with the AppImage, .deb or .rpm package, plus the Secret Service requirement for storing secrets.
---

# Install TestPion on Linux

## Requirements

- A 64-bit (x86_64) distribution from 2020 or later, for example Ubuntu 20.04+, Debian 11+, Fedora 36+ or openSUSE Leap 15.4+.
- A desktop environment with a **Secret Service** provider (GNOME Keyring or KWallet) to store secrets. Most desktops have one; without it the app refuses to save secrets rather than store them unencrypted.

## Download

<Downloads only="linux" />

## AppImage (any distribution)

```bash
chmod +x TestPion-*-linux-x86_64.AppImage
./TestPion-*-linux-x86_64.AppImage
```

On Ubuntu 22.04 and later, AppImages need FUSE 2: `sudo apt install libfuse2` (on Ubuntu 24.04: `libfuse2t64`).

## Debian, Ubuntu and derivatives (.deb)

```bash
sudo apt install ./TestPion-*-linux-amd64.deb
```

## Fedora, RHEL and openSUSE (.rpm)

```bash
sudo dnf install ./TestPion-*-linux-x86_64.rpm     # Fedora, RHEL, Rocky
sudo zypper install ./TestPion-*-linux-x86_64.rpm  # openSUSE
```

The packages add **TestPion** to your application menu.

Continue with [your first request](/getting-started/first-request).

## Updating

Install the newer package the same way, or replace the AppImage. Your workspaces and settings in `~/.testpion` are kept.

## Uninstall

```bash
sudo apt remove testpion     # .deb
sudo dnf remove testpion     # .rpm
```

To remove your data too, delete `~/.testpion` and `~/.config/TestPion`.

## Troubleshooting

- **The window is blank or the app crashes on start** (some virtual machines and older GPUs): start it with `--disable-gpu`.
- **"Secure storage is not available"** when saving a secret: install and unlock `gnome-keyring` (or KWallet), or supply the secret as a `TESTPION_SECRET_*` environment variable.
