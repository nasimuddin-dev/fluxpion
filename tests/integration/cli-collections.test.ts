import { describe, it, expect, afterAll } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// `testpion collections` and `testpion requests` show what a workspace holds, gRPC calls and connections
// included (the same as the list_collections / list_requests MCP tools).
const dir = mkdtempSync(join(tmpdir(), 'tp-cli-cols-'));
const ws = join(dir, 'ws');
cpSync(join(process.cwd(), 'examples', 'public-workspace'), ws, { recursive: true, filter: (p) => !/database\.sqlite|[\/](runs|traces|payloads)([\/]|$)/.test(p) });
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
const cli = (...args: string[]) => {
  const r = spawnSync(process.execPath, [join(process.cwd(), 'packages/cli/bin/testpion.js'), ...args, '-w', ws], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

describe('CLI: collections and requests', () => {
  it('lists collections with their gRPC calls and connections', () => {
    const r = cli('collections', '--json');
    expect(r.status, r.err).toBe(0);
    const rows = JSON.parse(r.out) as Array<{ id: string; requests: number; grpcCalls: number; connections: number }>;
    expect(rows.find((c) => c.id === 'grpc')).toMatchObject({ requests: 0, grpcCalls: 3, connections: 0 });
    expect(rows.find((c) => c.id === 'realtime')).toMatchObject({ grpcCalls: 0, connections: 3 });
    expect(rows.find((c) => c.id === 'httpbin')!.requests).toBeGreaterThan(5);
  });

  it('lists what one collection holds', () => {
    const grpc = JSON.parse(cli('requests', 'gRPC (grpcb.in)', '--json').out) as Array<{ kind: string; target: string }>;
    expect(grpc.map((r) => r.kind)).toEqual(['grpc', 'grpc', 'grpc']);
    expect(grpc[0]!.target).toMatch(/\{\{grpcHost\}\} hello\.HelloService\//);
    const text = cli('requests', 'realtime').out;
    expect(text).toMatch(/MQTT\s+MQTT brokers \/ Mosquitto test broker/);
    const missing = cli('requests', 'nope');
    expect(missing.status).not.toBe(0);
    expect(missing.err).toMatch(/No collection "nope"/);
  });
});
