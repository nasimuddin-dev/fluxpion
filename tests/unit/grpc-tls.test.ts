import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { ReflectionService } from '@grpc/reflection';
import { executeGrpc, grpcCredentials, parseProtos, reflectServer } from '../../packages/core/src/index.js';

// test-only certificates (tests/fixtures/tls): a CA, a server certificate for 127.0.0.1, a client certificate
const pem = (f: string) => readFileSync(join('tests/fixtures/tls', f), 'utf8');
const CA = pem('ca.crt');
const PROTO = [{ name: 'hello.proto', text: 'syntax = "proto3";\npackage hi;\nmessage Req { string name = 1; }\nmessage Res { string text = 1; }\nservice Hello { rpc Say(Req) returns (Res); }\n' }];

const servers: grpc.Server[] = [];
afterAll(() => servers.forEach((s) => s.forceShutdown()));

async function start(requireClientCert: boolean): Promise<string> {
  const def = protoLoader.fromJSON(parseProtos(PROTO).toJSON(), { keepCase: true });
  const pkg = grpc.loadPackageDefinition(def) as any;
  const server = new grpc.Server();
  server.addService(pkg.hi.Hello.service, { Say: (call: any, cb: any) => cb(null, { text: `hi ${call.request.name}` }) });
  new ReflectionService(def).addToServer(server);
  servers.push(server);
  const creds = grpc.ServerCredentials.createSsl(Buffer.from(CA), [{ cert_chain: Buffer.from(pem('server.crt')), private_key: Buffer.from(pem('server.key')) }], requireClientCert);
  const port = await new Promise<number>((ok, fail) => server.bindAsync('127.0.0.1:0', creds, (e, p) => (e ? fail(e) : ok(p))));
  return `127.0.0.1:${port}`;
}

describe('gRPC over TLS', () => {
  it('trusts a custom CA, and fails with the system CAs', async () => {
    const address = await start(false);
    const ok = await executeGrpc({ target: `grpcs://${address}`, method: 'hi.Hello/Say', message: '{"name":"tls"}', protoFiles: PROTO, tlsOptions: { ca: CA } });
    expect(ok).toMatchObject({ code: 0, response: { text: 'hi tls' } });
    await expect(executeGrpc({ target: `grpcs://${address}`, method: 'hi.Hello/Say', protoFiles: PROTO, timeoutMs: 5000 })).rejects.toThrow(/UNAVAILABLE|DEADLINE/);
  });

  it('sends a client certificate for mutual TLS (and reflection works over it)', async () => {
    const address = await start(true);
    const mtls = { ca: CA, cert: pem('client.crt'), key: pem('client.key') };
    const r = await executeGrpc({ target: address, method: 'hi.Hello/Say', message: '{"name":"mtls"}', protoFiles: PROTO, tlsOptions: mtls });
    expect(r).toMatchObject({ code: 0, response: { text: 'hi mtls' } });
    await expect(executeGrpc({ target: address, method: 'hi.Hello/Say', protoFiles: PROTO, tlsOptions: { ca: CA }, timeoutMs: 5000 })).rejects.toThrow(/UNAVAILABLE|DEADLINE/);
    const refl = await reflectServer({ address, tls: true }, { tlsOptions: mtls });
    expect(refl.services).toEqual(['hi.Hello']);
  });

  it('checks the certificate options', () => {
    expect(() => grpcCredentials(true, { cert: pem('client.crt') })).toThrow(/both the client certificate and its private key/);
    expect(grpcCredentials(false)).toBeDefined();
  });
});
