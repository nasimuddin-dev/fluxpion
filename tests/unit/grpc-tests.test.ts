import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { McpSession, mcpResultBody, parseProtos } from '../../packages/core/src/index.js';

const COMMON = `syntax = "proto3";\npackage shop.v1;\nmessage Item { string sku = 1; int32 qty = 2; }\n`;
const SHOP = `syntax = "proto3";\npackage shop.v1;\nimport "shop/v1/common.proto";\nmessage Get { string sku = 1; }\nmessage Empty {}\nservice Shop {\n  rpc GetItem(Get) returns (Item);\n  rpc Stock(Empty) returns (stream Item);\n}\n`;

const cli = (args: string[], cwd: string) =>
  new Promise<{ status: number | null; stdout: string }>((ok) => {
    const p = spawn(process.execPath, [join(process.cwd(), 'packages/cli/bin/testpion.js'), ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stdout += d));
    p.on('close', (status) => ok({ status, stdout }));
  });

describe('gRPC tests (test files, runner, CLI)', () => {
  it('runs grpc tests with grpc-status and body assertions, reading protos from the workspace', async () => {
    const root = parseProtos([
      { name: 'shop/v1/shop.proto', text: SHOP },
      { name: 'shop/v1/common.proto', text: COMMON },
    ]);
    const pkg = grpc.loadPackageDefinition(protoLoader.fromJSON(root.toJSON(), { keepCase: true, defaults: true })) as any;
    const server = new grpc.Server();
    server.addService(pkg.shop.v1.Shop.service, {
      GetItem: (call: any, cb: any) => (call.request.sku === 'x' ? cb({ code: grpc.status.NOT_FOUND, details: 'no item x' }) : cb(null, { sku: call.request.sku, qty: 3 })),
      Stock: (call: any) => {
        call.write({ sku: 'a', qty: 1 });
        call.write({ sku: 'b', qty: 0 });
        call.end();
      },
    });
    const port = await new Promise<number>((ok, fail) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? fail(e) : ok(p))));
    const dir = mkdtempSync(join(tmpdir(), 'tp-grpc-'));
    const ws = join(dir, 'ws');
    try {
      expect((await cli(['workspace', 'create', 'shop', '--path', ws], dir)).status).toBe(0);
      mkdirSync(join(ws, 'protos', 'shop', 'v1'), { recursive: true });
      writeFileSync(join(ws, 'protos', 'shop', 'v1', 'shop.proto'), SHOP);
      writeFileSync(join(ws, 'protos', 'shop', 'v1', 'common.proto'), COMMON);
      const protos = '[protos/shop/v1/shop.proto, protos/shop/v1/common.proto]';
      writeFileSync(
        join(ws, 'tests', 'shop.yaml'),
        [
          'tests:',
          '  - name: item found',
          '    type: grpc',
          `    target: 127.0.0.1:${port}`,
          '    method: shop.v1.Shop/GetItem',
          '    message: { sku: abc }',
          `    protos: ${protos}`,
          '    assertions: [{ type: equals, path: $.qty, expected: 3 }]',
          '  - name: unknown item',
          '    type: grpc',
          `    target: 127.0.0.1:${port}`,
          '    method: shop.v1.Shop/GetItem',
          '    message: { sku: x }',
          `    protos: ${protos}`,
          '    assertions: [{ type: grpc-status, expected: NOT_FOUND }]',
          '  - name: stock stream',
          '    type: grpc',
          `    target: 127.0.0.1:${port}`,
          '    method: shop.v1.Shop/Stock',
          `    protos: ${protos}`,
          '    assertions: [{ type: length, path: $, expected: 2 }, { type: equals, path: "$[1].sku", expected: b }]',
          '  - name: expected to fail',
          '    type: grpc',
          `    target: 127.0.0.1:${port}`,
          '    method: shop.v1.Shop/GetItem',
          '    message: { sku: x }',
          `    protos: ${protos}`,
        ].join('\n'),
      );
      const run = await cli(['test', '-w', ws, '-r', 'json', '-o', join(dir, 'out')], dir);
      const report = JSON.parse(readFileSync(join(dir, 'out', 'report.json'), 'utf8')) as { summary: { passed: number; failed: number }; results: Array<{ name: string; status: string; checks: Array<{ message: string }> }> };
      expect(report.summary).toMatchObject({ passed: 3, failed: 1 });
      const failed = report.results.find((r) => r.name === 'expected to fail')!;
      expect(failed.checks[0]!.message).toBe('expected OK, got 5 NOT_FOUND: no item x');
      expect(run.status).toBe(1);

      // AI agents: the grpc_call MCP tool (not offered in read-only mode, since it calls the server)
      const bin = join(process.cwd(), 'packages/cli/bin/testpion.js');
      const env = { TESTPION_HOME: join(dir, 'home') };
      const s = new McpSession({ id: 'g', name: 'testpion', transport: 'stdio', command: process.execPath, args: [bin, 'mcp-server', '-w', ws], env });
      try {
        await s.connect(20_000);
        const protoArg = ['protos/shop/v1/shop.proto', 'protos/shop/v1/common.proto'];
        const list = JSON.parse(mcpResultBody(await s.callTool('grpc_call', { protos: protoArg })).text) as Array<{ method: string }>;
        expect(list.map((m) => m.method)).toEqual(['shop.v1.Shop/GetItem', 'shop.v1.Shop/Stock']);
        const got = JSON.parse(mcpResultBody(await s.callTool('grpc_call', { target: `127.0.0.1:${port}`, method: 'shop.v1.Shop/GetItem', message: { sku: 'z' }, protos: protoArg })).text);
        expect(got).toMatchObject({ code: 0, status: 'OK', response: '{"sku":"z","qty":3}' });
        const escape = await s.callTool('grpc_call', { protos: ['../../outside.proto'] });
        expect(escape.isError).toBe(true);
      } finally {
        await s.close();
      }
      const ro = new McpSession({ id: 'ro', name: 'testpion-ro', transport: 'stdio', command: process.execPath, args: [bin, 'mcp-server', '-w', ws, '--read-only'], env });
      try {
        await ro.connect(20_000);
        expect((await ro.discover()).tools.map((t) => t.name)).not.toContain('grpc_call');
      } finally {
        await ro.close();
      }
    } finally {
      server.forceShutdown();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
