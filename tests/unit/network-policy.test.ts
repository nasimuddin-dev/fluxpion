import { afterEach, describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpSession, WebSocketSession, assertUrlAllowed, executeHttp, isPrivateAddress, policyFromEnv, setNetworkPolicy } from '../../packages/core/src/index.js';

describe('network policy (for shared / hosted servers)', () => {
  afterEach(() => setNetworkPolicy({ blockPrivateNetworks: false, allowHosts: [], allowProcesses: true }));

  it('classifies private, local and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('allows everything by default (desktop) and blocks private hosts when switched on', async () => {
    await expect(assertUrlAllowed('http://127.0.0.1:1/x')).resolves.toBeUndefined();
    setNetworkPolicy({ blockPrivateNetworks: true });
    await expect(assertUrlAllowed('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/network policy/);
    await expect(assertUrlAllowed('http://localhost:8080/')).rejects.toThrow(/network policy/);
    await expect(assertUrlAllowed('http://[::1]:8080/')).rejects.toThrow(/network policy/);
    setNetworkPolicy({ allowHosts: ['127.0.0.1'] });
    await expect(assertUrlAllowed('http://127.0.0.1:8080/')).resolves.toBeUndefined();
  });

  it('reads the policy from the environment', () => {
    expect(policyFromEnv({})).toBeUndefined();
    expect(policyFromEnv({ TESTPION_BLOCK_PRIVATE_NETWORKS: '1', TESTPION_ALLOW_HOSTS: 'a.internal, b', TESTPION_ALLOW_PROCESSES: '0' })).toEqual({ blockPrivateNetworks: true, allowHosts: ['a.internal', 'b'], allowProcesses: false });
  });

  it('blocks HTTP requests and redirects into private networks', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: `http://localhost:${(server.address() as AddressInfo).port}/secret` });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('internal data');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await executeHttp({ method: 'GET', url: `${base}/ok` })).response.status).toBe(200);
      setNetworkPolicy({ blockPrivateNetworks: true });
      await expect(executeHttp({ method: 'GET', url: `${base}/ok` })).rejects.toThrow(/network policy/);
      // an allowed host that redirects to a private one is stopped at the redirect
      setNetworkPolicy({ allowHosts: ['127.0.0.1'] });
      expect((await executeHttp({ method: 'GET', url: `${base}/ok` })).response.status).toBe(200);
      await expect(executeHttp({ method: 'GET', url: `${base}/redirect` })).rejects.toThrow(/network policy/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('blocks WebSocket handshakes and MCP stdio servers', async () => {
    setNetworkPolicy({ blockPrivateNetworks: true, allowProcesses: false });
    await expect(new WebSocketSession('ws://127.0.0.1:1/socket').connect(2000)).rejects.toThrow(/network policy/);
    await expect(new McpSession({ id: 's', name: 'local tool', transport: 'stdio', command: 'node', args: ['-e', ''] }).connect(2000)).rejects.toThrow(/starting local programs/);
  });
});
