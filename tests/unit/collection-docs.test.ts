import { describe, expect, it } from 'vitest';
import { collectionMarkdown, docsAnchor, type Collection } from '../../packages/core/src/index.js';

const collection: Collection = {
  schemaVersion: '1.0',
  id: 'c',
  name: 'Pets API',
  description: 'Manage **pets**.',
  version: 3,
  variables: [
    { key: 'baseUrl', value: 'https://api.example.com' },
    { key: 'apiKey', value: 'k-SECRET' },
  ],
  auth: { type: 'bearer', token: '{{token}}' },
  updatedAt: '',
  items: [
    {
      kind: 'folder',
      id: 'f1',
      name: 'Pets',
      items: [
        {
          kind: 'http',
          id: 'r1',
          name: 'Create pet',
          description: 'Creates a pet.\n\nThe `name` is required.',
          request: {
            method: 'post',
            url: '{{baseUrl}}/pets?token=abc',
            headers: [
              { key: 'Authorization', value: 'Bearer live-token' },
              { key: 'X-Trace', value: 'on', description: 'Adds tracing' },
              { key: 'X-Off', value: 'x', enabled: false },
            ],
            body: { type: 'json', content: '{"name":"Rex","password":"hunter2"}' },
            auth: { type: 'inherit' },
          },
          examples: [{ id: 'e1', name: 'Created', status: 201, statusText: 'Created', headers: [{ key: 'content-type', value: 'application/json' }], body: '{"id":1}' }],
        },
      ],
    },
    { kind: 'graphql', id: 'g1', name: 'Search', request: { endpoint: 'https://api.example.com/graphql', query: '{ pets { id } }' } },
  ],
};

describe('collectionMarkdown', () => {
  const md = collectionMarkdown(collection);

  it('documents the collection, folders and requests in order with a table of contents', () => {
    expect(md.startsWith('# Pets API\n\nManage **pets**.')).toBe(true);
    expect(md).toContain('**Authorization:** Bearer token');
    expect(md).toContain(`- [Pets](#${docsAnchor('f1')})\n  - [POST Create pet](#${docsAnchor('r1')})\n- [GRAPHQL Search](#${docsAnchor('g1')})`);
    expect(md.indexOf('## Pets')).toBeLessThan(md.indexOf('### Create pet'));
    expect(md).toContain('`POST {{baseUrl}}/pets?token=REDACTED`');
    expect(md).toContain('Creates a pet.\n\nThe `name` is required.');
    expect(md).toContain('**Authorization:** Inherited from the folder or collection');
    expect(md).toContain('| `X-Trace` | on | Adds tracing |');
    expect(md).not.toContain('X-Off');
    expect(md).toContain('**Example: Created** · `201 Created`');
    expect(md).toContain('```json\n{\n  "id": 1\n}\n```');
    expect(md).toContain('```graphql\n{ pets { id } }\n```');
  });

  it('masks secrets in variables, headers, bodies and URLs', () => {
    expect(md).not.toContain('k-SECRET');
    expect(md).not.toContain('live-token');
    expect(md).not.toContain('hunter2');
    expect(md).toContain('| `apiKey` | •••••• |');
  });

  it('shows variable references for sensitive names, since they are not secrets', () => {
    const c: Collection = { ...collection, variables: [{ key: 'apiKey', value: '{{$secret.api.key}}' }] };
    expect(collectionMarkdown(c)).toContain('| `apiKey` | {{$secret.api.key}} |');
  });

  it('can leave out examples', () => {
    expect(collectionMarkdown(collection, { examples: false })).not.toContain('Example: Created');
  });
});
