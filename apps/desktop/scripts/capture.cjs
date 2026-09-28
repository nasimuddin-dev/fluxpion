// Captures documentation screenshots of the real app:
//   npm run screenshots -w @fluxpion/desktop   (FLUXPION_CAPTURE_OUT=<dir> writes elsewhere)
// Starts the demo servers, copies the example workspace into a temporary profile,
// launches Electron in capture mode and writes docs/public/images/*.jpg.
const { spawn, spawnSync } = require('node:child_process');
const { cpSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..', '..', '..');
const home = mkdtempSync(join(tmpdir(), 'aps-capture-'));
const ws = join(home, 'examples', 'veterinary-workspace');
cpSync(join(root, 'examples', 'veterinary-workspace'), ws, { recursive: true, filter: (s) => !/[\\/](runs|traces|payloads)([\\/]|$)|database\.sqlite/.test(s) });
// the copied workspace launches the repo's MCP server (which needs the repo's node_modules)
writeFileSync(
  join(ws, 'mcp-servers.json'),
  JSON.stringify({ schemaVersion: '1.0', servers: [{ id: 'customer-mcp', name: 'customer-mcp', transport: 'stdio', command: 'node', args: [join(root, 'examples', 'servers', 'mcp-server.mjs')] }] }, null, 2),
);
writeFileSync(join(home, 'settings.json'), JSON.stringify({ lastWorkspace: ws, workspacePaths: [ws], theme: process.env.FLUXPION_CAPTURE_THEME ?? 'dark' }, null, 2));

const servers = spawn(process.execPath, [join(root, 'examples', 'servers', 'demo-servers.mjs')], { stdio: 'ignore' });
setTimeout(() => {
  const electron = require('electron');
  const r = spawnSync(electron, ['.'], {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, FLUXPION_HOME: home, FLUXPION_CAPTURE_SCRIPT: join(__dirname, 'capture-steps.cjs'), FLUXPION_CAPTURE_DIR: process.env.FLUXPION_CAPTURE_OUT ?? join(root, 'docs', 'public', 'images') },
  });
  servers.kill();
  rmSync(home, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}, 1500);
