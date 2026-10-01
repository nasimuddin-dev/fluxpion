// Captures documentation screenshots of the real app:
//   npm run screenshots -w @testpion/desktop   (TESTPION_CAPTURE_OUT=<dir> writes elsewhere)
// Starts the demo servers, copies the example workspace into a temporary profile,
// launches Electron in capture mode and writes docs/public/images/*.jpg.
const { spawn, spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = resolve(__dirname, '..', '..', '..');
const home = mkdtempSync(join(tmpdir(), 'aps-capture-'));
const ws = join(home, 'examples', 'veterinary-workspace');
// the committed example only (git HEAD), so local, uncommitted edits to it never end up in public screenshots
const tracked = spawnSync('git', ['ls-files', '-z', 'examples/veterinary-workspace'], { cwd: root, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
for (const rel of tracked) {
  if (/[\\/](runs|traces|payloads)([\\/]|$)|database\.sqlite/.test(rel)) continue;
  const content = spawnSync('git', ['show', `HEAD:${rel}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).stdout;
  const dest = join(ws, rel.slice('examples/veterinary-workspace/'.length));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}
// the example's MCP server is {{workspaceDir}}/../servers/mcp-server.mjs: a shim there runs the repo's
// server (which needs the repo's node_modules), so screenshots show the committed, portable command
mkdirSync(join(home, 'examples', 'servers'), { recursive: true });
writeFileSync(join(home, 'examples', 'servers', 'mcp-server.mjs'), `import ${JSON.stringify(pathToFileURL(join(root, 'examples', 'servers', 'mcp-server.mjs')).href)};
`);
writeFileSync(join(home, 'settings.json'), JSON.stringify({ lastWorkspace: ws, workspacePaths: [ws], theme: process.env.TESTPION_CAPTURE_THEME ?? 'dark' }, null, 2));

const servers = spawn(process.execPath, [join(root, 'examples', 'servers', 'demo-servers.mjs')], { stdio: 'ignore' });
setTimeout(() => {
  const electron = require('electron');
  const r = spawnSync(electron, ['.'], {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, TESTPION_HOME: home, TESTPION_CAPTURE_SCRIPT: process.env.TESTPION_CAPTURE_SCRIPT ?? join(__dirname, 'capture-steps.cjs'), TESTPION_CAPTURE_DIR: process.env.TESTPION_CAPTURE_OUT ?? join(root, 'docs', 'public', 'images') },
  });
  servers.kill();
  rmSync(home, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}, 1500);
