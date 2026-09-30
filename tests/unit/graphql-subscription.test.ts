import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { collectSubscriptionEvents, startGraphQLSubscription, subscriptionUrl, type SubscriptionEvent } from '../../packages/core/src/index.js';

/** A tiny GraphQL subscription server speaking one protocol: 3 ticks, then complete. */
function server(protocol: 'graphql-transport-ws' | 'graphql-ws', opts: { refuse?: boolean } = {}) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: (ps) => (ps.has(protocol) ? protocol : false) });
  const seen: Array<{ type: string; payload?: any }> = [];
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      seen.push(m);
      if (m.type === 'connection_init') {
        if (opts.refuse) return ws.send(JSON.stringify({ type: 'connection_error', payload: { message: 'bad token' } }));
        ws.send(JSON.stringify({ type: 'connection_ack' }));
      }
      if (m.type === 'subscribe' || m.type === 'start') {
        let n = 0;
        const t = setInterval(() => {
          n++;
          ws.send(JSON.stringify({ id: m.id, type: protocol === 'graphql-ws' ? 'data' : 'next', payload: { data: { tick: n, who: m.payload.variables.who } } }));
          if (n === 3) {
            clearInterval(t);
            ws.send(JSON.stringify({ id: m.id, type: 'complete' }));
          }
        }, 20);
      }
    });
  });
  return { wss, seen, url: () => `http://127.0.0.1:${(wss.address() as AddressInfo).port}/graphql` };
}

const modern = server('graphql-transport-ws');
const legacy = server('graphql-ws');
const refusing = server('graphql-transport-ws', { refuse: true });
beforeAll(async () => {
  await Promise.all([modern, legacy, refusing].map((s) => new Promise<void>((r) => (s.wss.address() ? r() : s.wss.once('listening', () => r())))));
});
afterAll(() => {
  for (const s of [modern, legacy, refusing]) s.wss.close();
});

describe('GraphQL subscriptions', () => {
  it('maps http(s) endpoints to ws(s)', () => {
    expect(subscriptionUrl('https://api.test/graphql')).toBe('wss://api.test/graphql');
    expect(subscriptionUrl('ws://x/graphql')).toBe('ws://x/graphql');
  });

  for (const [name, s] of [['graphql-transport-ws', modern], ['graphql-ws (legacy)', legacy]] as const) {
    it(`streams events with ${name}`, async () => {
      const events: SubscriptionEvent[] = [];
      const sub = await startGraphQLSubscription({ url: s.url(), query: 'subscription($who: String) { tick }', variables: { who: 'Rex' }, connectionParams: { authorization: 'Bearer t' }, onEvent: (e) => events.push(e) });
      await sub.done;
      expect(events.filter((e) => e.type === 'next').map((e) => (e.data as { data: { tick: number; who: string } }).data)).toEqual([
        { tick: 1, who: 'Rex' },
        { tick: 2, who: 'Rex' },
        { tick: 3, who: 'Rex' },
      ]);
      expect(events.some((e) => e.type === 'complete')).toBe(true);
      expect(s.seen[0]).toEqual({ type: 'connection_init', payload: { authorization: 'Bearer t' } });
    });
  }

  it('collects events for the CLI and agents', async () => {
    const r = await collectSubscriptionEvents({ url: modern.url(), query: 'subscription($who: String) { tick }', variables: { who: 'Ada' }, maxEvents: 2 });
    expect(r.events).toEqual([{ data: { tick: 1, who: 'Ada' } }, { data: { tick: 2, who: 'Ada' } }]);
    const all = await collectSubscriptionEvents({ url: modern.url(), query: 'subscription($who: String) { tick }', variables: { who: 'Ada' }, maxEvents: 50 });
    expect(all).toMatchObject({ completed: true, protocol: 'graphql-transport-ws' });
    expect(all.events).toHaveLength(3);
  });

  it('reports a refused connection', async () => {
    await expect(startGraphQLSubscription({ url: refusing.url(), query: 'subscription { tick }', onEvent: () => undefined })).rejects.toThrow(/refused the connection/);
  });
});
