import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, listCertificates, recordCertificate } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-certs-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('certificates seen per host', () => {
  it('keeps the newest certificate of each host, soonest to expire first, and survives a reopen', () => {
    const store = WorkspaceStore.create(join(dir, 'ws'), 'Certs');
    const now = Date.parse('2026-10-01T00:00:00Z');
    recordCertificate(store, 'https://api.example.com/v1/pets', { subject: 'api.example.com', issuer: 'R11', validTo: '2026-12-30T00:00:00Z' }, now);
    recordCertificate(store, 'https://old.example.com:8443/', { subject: 'old.example.com', issuer: 'Internal CA', validTo: '2026-10-11T00:00:00Z' }, now);
    // a renewed certificate replaces the old one at once; plain http and missing dates are ignored
    recordCertificate(store, 'https://api.example.com/other', { subject: 'api.example.com', issuer: 'R12', validTo: '2027-01-15T00:00:00Z' }, now + 1000);
    recordCertificate(store, 'http://plain.example.com/', undefined, now);
    const list = listCertificates(store, now);
    expect(list.map((c) => [c.host, c.daysLeft, c.issuer])).toEqual([
      ['old.example.com:8443', 10, 'Internal CA'],
      ['api.example.com', 106, 'R12'],
    ]);
    expect(JSON.parse(readFileSync(store.path('runs', 'certificates.json'), 'utf8'))).toHaveLength(2);
    store.close();
    const again = WorkspaceStore.open(join(dir, 'ws'));
    expect(listCertificates(again, now).map((c) => c.host)).toEqual(['old.example.com:8443', 'api.example.com']);
    again.close();
  });
});
