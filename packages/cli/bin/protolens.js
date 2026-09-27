#!/usr/bin/env node
import { main } from '../dist/index.js';

// Let the event loop drain instead of calling process.exit() right away: exiting while libuv is still
// finishing file work aborts Node on Windows ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)").
// Pending stdout writes are flushed before a natural exit. If something keeps the loop alive (an MCP
// child process, a keep-alive socket), the unref'd timer forces the exit after a grace period.
const exitWith = (code) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 3000).unref();
};

main().then(exitWith, (err) => {
  console.error(err);
  exitWith(3);
});
