# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories ("Report a vulnerability") rather than a public issue. Include reproduction steps and the affected version. We aim to acknowledge reports within 3 business days.

## Security model

- **Secrets** are encrypted with the OS credential store and never written to workspace files, exports, logs, traces or reports. If no secure backend is available, the app refuses to store a secret instead of falling back to plain text.
- **Redaction** covers configurable sensitive field names and every secret value registered during a run.
- **Scripts** run in a QuickJS WebAssembly sandbox with no filesystem, network or process access and with CPU and memory limits.
- **Electron hardening:** `contextIsolation`, a sandboxed renderer, no `nodeIntegration`, a strict CSP, blocked navigation and window creation, and a narrow RPC-only preload.
- **Load testing** is restricted to local and private hosts unless you explicitly opt in, and production environments are blocked by default.
- **Telemetry** is not implemented.

The browser development bridge (`npm run dev:web`) binds to `127.0.0.1` only and requires a per-process token. It is intended for development, not production use.
