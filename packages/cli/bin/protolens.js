#!/usr/bin/env node
import { main } from '../dist/index.js';

main().then(
  (code) => {
    // flush stdout before exiting (important for piped CI output)
    process.stdout.write('', () => process.exit(code));
  },
  (err) => {
    console.error(err);
    process.exit(3);
  },
);
