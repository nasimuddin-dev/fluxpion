import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import protobuf from 'protobufjs';
import { describeProtos, executeGrpc, parseProtos, type ProtoFile } from '../../packages/core/src/index.js';

const COMMON: ProtoFile = {
  name: 'vet/v1/common.proto',
  text: `syntax = "proto3";
package vet.v1;
import "google/protobuf/timestamp.proto";
enum Species { SPECIES_UNSPECIFIED = 0; CAT = 1; DOG = 2; }
message Pet { int64 id = 1; string name = 2; Species species = 3; google.protobuf.Timestamp born = 4; repeated string tags = 5; }`,
};
const SERVICE: ProtoFile = {
  name: 'vet/v1/pets.proto',
  text: `syntax = "proto3";
package vet.v1;
import "vet/v1/common.proto";
message GetPetRequest { int64 id = 1; }
message ListPetsRequest { int32 count = 1; bool forever = 2; }
message CreatePetsResponse { int32 created = 1; }
service PetService {
  rpc GetPet(GetPetRequest) returns (Pet);
  rpc ListPets(ListPetsRequest) returns (stream Pet);
  rpc CreatePets(stream Pet) returns (CreatePetsResponse);
  rpc Echo(stream Pet) returns (stream Pet);
}`,
};
const FILES = [SERVICE, COMMON];

let server: grpc.Server;
let target = '';

beforeAll(async () => {
  const root = parseProtos(FILES);
  const pkg = grpc.loadPackageDefinition(protoLoader.fromJSON(root.toJSON(), { keepCase: true, longs: String, enums: String, defaults: true })) as any;
  server = new grpc.Server();
  server.addService(pkg.vet.v1.PetService.service, {
    GetPet: (call: any, cb: any) => {
      if (call.request.id === '404') return cb({ code: grpc.status.NOT_FOUND, details: 'no pet 404' });
      if (call.request.id === '999') return setTimeout(() => cb(null, {}), 2000);
      const md = new grpc.Metadata();
      md.set('x-served-by', 'test');
      call.sendMetadata(md);
      cb(null, { id: call.request.id, name: `pet ${call.request.id}`, species: 'CAT', tags: [call.metadata.get('x-trace')[0] ?? 'none'] });
    },
    ListPets: (call: any) => {
      let n = 0;
      const t = setInterval(() => {
        call.write({ id: String(n), name: `pet ${n}` });
        n++;
        if (!call.request.forever && n >= call.request.count) {
          clearInterval(t);
          call.end();
        }
      }, 10);
      call.on('cancelled', () => clearInterval(t));
    },
    CreatePets: (call: any, cb: any) => {
      let created = 0;
      call.on('data', () => created++);
      call.on('end', () => cb(null, { created }));
    },
    Echo: (call: any) => {
      call.on('data', (p: any) => call.write({ ...p, name: p.name.toUpperCase() }));
      call.on('end', () => call.end());
    },
  });
  const port = await new Promise<number>((ok, fail) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? fail(e) : ok(p))));
  target = `127.0.0.1:${port}`;
});
afterAll(() => server.forceShutdown());

describe('gRPC', () => {
  it('describes services from proto files (imports, well-known types, example messages)', () => {
    const methods = describeProtos(FILES);
    expect(methods.map((m) => `${m.name} ${m.clientStreaming ? 'c' : ''}${m.serverStreaming ? 's' : ''}`)).toEqual([
      'vet.v1.PetService/GetPet ',
      'vet.v1.PetService/ListPets s',
      'vet.v1.PetService/CreatePets c',
      'vet.v1.PetService/Echo cs',
    ]);
    expect(methods[0]!.example).toEqual({ id: '0' });
    const pet = methods[2]!.example as Record<string, unknown>;
    expect(pet).toMatchObject({ id: '0', name: '', species: 'SPECIES_UNSPECIFIED', tags: [''] });
    expect(pet.born).toHaveProperty('seconds');
    expect(() => describeProtos([SERVICE])).toThrow(/imports "vet\/v1\/common.proto", which was not provided/);
    expect(protobuf).toBeDefined();
  });

  it('calls a unary method with metadata and returns headers and trailers', async () => {
    const r = await executeGrpc({ target, method: 'vet.v1.PetService/GetPet', message: '{"id": "7"}', metadata: [{ key: 'X-Trace', value: 'abc' }], protoFiles: FILES });
    expect(r).toMatchObject({ code: 0, codeName: 'OK', response: { id: '7', name: 'pet 7', species: 'CAT', tags: ['abc'] } });
    expect(r.metadata).toContainEqual(['x-served-by', 'test']);
  });

  it('returns error statuses as results, and fails clearly when the server is unreachable', async () => {
    const r = await executeGrpc({ target: `grpc://${target}`, method: 'PetService/GetPet', message: '{"id":"404"}', protoFiles: FILES });
    expect(r).toMatchObject({ code: 5, codeName: 'NOT_FOUND', details: 'no pet 404' });
    const slow = await executeGrpc({ target, method: 'vet.v1.PetService/GetPet', message: '{"id":"999"}', protoFiles: FILES, timeoutMs: 200 }).catch((e) => e);
    expect(String(slow.message ?? slow.codeName)).toMatch(/DEADLINE_EXCEEDED/);
    await expect(executeGrpc({ target: '127.0.0.1:1', method: 'vet.v1.PetService/GetPet', protoFiles: FILES, timeoutMs: 2000 })).rejects.toThrow(/UNAVAILABLE|DEADLINE/);
    await expect(executeGrpc({ target, method: 'vet.v1.PetService/Nope', protoFiles: FILES })).rejects.toThrow(/not in the proto files/);
  });

  it('streams from the server, and stopping keeps the messages so far', async () => {
    const seen: unknown[] = [];
    const r = await executeGrpc({ target, method: 'vet.v1.PetService/ListPets', message: '{"count": 3}', protoFiles: FILES }, { onMessage: (d) => seen.push(d) });
    expect(r.code).toBe(0);
    expect(r.messages!.map((m) => (m.data as { name: string }).name)).toEqual(['pet 0', 'pet 1', 'pet 2']);
    expect(seen).toHaveLength(3);

    const ctrl = new AbortController();
    const stopped = await executeGrpc({ target, method: 'vet.v1.PetService/ListPets', message: '{"forever": true}', protoFiles: FILES }, { signal: ctrl.signal, onMessage: (d) => (seen.push(d), seen.length > 5 && ctrl.abort()) });
    expect(stopped).toMatchObject({ streamStopped: true, codeName: 'CANCELLED' });
    expect(stopped.messages!.length).toBeGreaterThanOrEqual(3);
  });

  it('client streaming and bidirectional calls send a list of messages', async () => {
    const c = await executeGrpc({ target, method: 'vet.v1.PetService/CreatePets', message: '[{"name":"a"},{"name":"b"},{"name":"c"}]', protoFiles: FILES });
    expect(c.response).toEqual({ created: 3 });
    const b = await executeGrpc({ target, method: 'vet.v1.PetService/Echo', message: '[{"name":"x"},{"name":"y"}]', protoFiles: FILES });
    expect(b.messages!.map((m) => (m.data as { name: string }).name)).toEqual(['X', 'Y']);
  });
});
