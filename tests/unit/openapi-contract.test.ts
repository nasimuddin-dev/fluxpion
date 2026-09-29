import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { findOperation, loadOpenApi, runChecks, validateAgainstOpenApi } from '../../packages/core/src/index.js';

const SPEC = `
openapi: 3.0.3
info: { title: Vet API, version: '1.0' }
servers:
  - url: https://api.example.com/{version}
    variables: { version: { default: v1 } }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { type: array, items: { $ref: '#/components/schemas/Pet' } }
  /pets/{pet-id}:
    get:
      operationId: getPet
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: '#/components/schemas/Pet' } } }
        '404':
          description: missing
          content: { application/problem+json: { schema: { type: object, required: [title], properties: { title: { type: string } } } } }
  /pets/mine:
    get:
      operationId: myPets
      responses: { '204': { description: none } }
components:
  schemas:
    Pet:
      type: object
      required: [id, name, species]
      additionalProperties: false
      properties:
        id: { type: integer, format: int64 }
        name: { type: string }
        species: { type: string, enum: [cat, dog] }
        owner: { type: string, nullable: true }
        born: { type: string, format: date }
`;
const doc = loadOpenApi(SPEC);
const pet = { id: 1, name: 'Byron', species: 'cat', owner: null, born: '2020-01-02' };

describe('OpenAPI contract', () => {
  it('finds operations by method and URL (server base path, templates, literal paths first)', () => {
    expect(findOperation(doc, 'GET', 'https://api.example.com/v1/pets/7')).toMatchObject({ operationId: 'getPet', params: { 'pet-id': '7' } });
    expect(findOperation(doc, 'GET', 'http://localhost:4010/v1/pets/mine')?.operationId).toBe('myPets');
    expect(findOperation(doc, 'GET', 'http://localhost/pets?x=1')?.operationId).toBe('listPets');
    expect(findOperation(doc, 'DELETE', 'http://localhost/v1/pets/7')).toBeUndefined();
  });

  it('validates the body against the documented schema (refs, nullable, formats, enums)', () => {
    const ok = validateAgainstOpenApi(doc, { method: 'GET', url: '/v1/pets/1' }, { status: 200, contentType: 'application/json; charset=utf-8', body: pet });
    expect(ok).toMatchObject({ passed: true, operation: 'GET /pets/{pet-id} (getPet)' });
    const bad = validateAgainstOpenApi(doc, { method: 'GET', url: '/v1/pets/1' }, { status: 200, contentType: 'application/json', body: { ...pet, species: 'fish', extra: 1, id: 'x' } });
    expect(bad.passed).toBe(false);
    expect(bad.errors.join(' | ')).toMatch(/species must be equal to one of the allowed values: cat, dog/);
    expect(bad.errors.join(' | ')).toMatch(/additional properties \(extra\)/);
    expect(bad.errors.join(' | ')).toMatch(/\/id must be integer/);
    const list = validateAgainstOpenApi(doc, { method: 'GET', url: '/v1/pets' }, { status: 200, contentType: 'application/json', body: [pet, { id: 2, name: 'Rex' }] });
    expect(list.errors.join()).toMatch(/\/1 must have required property 'species'/);
  });

  it('flags undocumented statuses and content types', () => {
    expect(validateAgainstOpenApi(doc, { method: 'GET', url: '/v1/pets/1' }, { status: 500, contentType: 'application/json', body: {} }).message).toBe(
      'status 500 is not documented for GET /pets/{pet-id} (getPet) (documented: 200, 404)',
    );
    expect(validateAgainstOpenApi(doc, { method: 'GET', url: '/v1/pets/1' }, { status: 404, contentType: 'application/problem+json', body: { title: 'Not found' } }).passed).toBe(true);
    expect(validateAgainstOpenApi(doc, { method: 'GET', url: '/v1/pets/1' }, { status: 404, contentType: 'text/html', body: '<h1>' }).message).toMatch(/content type "text\/html" is not documented/);
    expect(validateAgainstOpenApi(doc, { method: 'GET', url: '/v1/pets/mine' }, { status: 204, body: '', text: '' }).passed).toBe(true);
    expect(validateAgainstOpenApi(doc, { method: 'GET', url: '/v1/owners' }, { status: 200, body: {} }).message).toBe('GET /v1/owners is not in the OpenAPI document');
  });

  it('supports Swagger 2.0 (basePath, definitions)', () => {
    const sw = loadOpenApi(JSON.stringify({ swagger: '2.0', basePath: '/api', paths: { '/a': { get: { responses: { 200: { schema: { $ref: '#/definitions/A' } } } } } }, definitions: { A: { type: 'object', required: ['x'] } } }));
    expect(validateAgainstOpenApi(sw, { method: 'GET', url: '/api/a' }, { status: 200, contentType: 'application/json', body: { x: 1 } }).passed).toBe(true);
    expect(validateAgainstOpenApi(sw, { method: 'GET', url: '/api/a' }, { status: 200, contentType: 'application/json', body: {} }).passed).toBe(false);
  });

  it('runs as the openapi check (spec from a workspace file, or inline)', async () => {
    const base = { testType: 'http' as const, status: 200, headers: [['content-type', 'application/json']] as Array<[string, string]>, body: pet, text: JSON.stringify(pet), request: { method: 'GET', url: 'http://localhost/v1/pets/1' } };
    const [fromFile] = await runChecks([{ type: 'openapi', spec: 'openapi.yaml' }], { ...base, readFile: () => SPEC });
    expect(fromFile).toMatchObject({ passed: true, name: 'OpenAPI contract' });
    const [inline] = await runChecks([{ type: 'openapi', spec: doc, operationId: 'listPets' }], base);
    expect(inline!.passed).toBe(false);
    const [noFile] = await runChecks([{ type: 'openapi', spec: 'openapi.yaml' }], base);
    expect(noFile!.message).toMatch(/inside a workspace/);
  });

  it('works from the CLI on a test file outside any workspace', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/v1/pets/1') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(pet));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'oops' }));
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const dir = mkdtempSync(join(tmpdir(), 'tp-openapi-'));
    try {
      writeFileSync(join(dir, 'openapi.yaml'), SPEC);
      writeFileSync(
        join(dir, 'contract.test.yaml'),
        [
          'tests:',
          '  - name: good',
          '    type: http',
          `    url: ${url}/v1/pets/1`,
          '    assertions: [{ type: openapi, spec: openapi.yaml }]',
          '  - name: bad',
          '    type: http',
          `    url: ${url}/v1/pets/2`,
          '    assertions: [{ type: openapi, spec: openapi.yaml }]',
        ].join('\n'),
      );
      // async: the test's own server has to answer while the CLI runs
      const r = await new Promise<{ status: number | null; stdout: string }>((ok) => {
        const p = spawn(process.execPath, [join(process.cwd(), 'packages/cli/bin/testpion.js'), 'test', 'contract.test.yaml', '-r', 'json', '-o', join(dir, 'out')], { cwd: dir, env: { ...process.env, NO_COLOR: '1' } });
        let stdout = '';
        p.stdout.on('data', (d) => (stdout += d));
        p.on('close', (status) => ok({ status, stdout }));
      });
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/✓ good/);
      expect(r.stdout).toMatch(/must have required property 'name'/);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
