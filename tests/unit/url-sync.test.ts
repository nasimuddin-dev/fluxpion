import { describe, expect, it } from 'vitest';
import { paramsFromUrl, urlFromParams, fromEngineRequest, toEngineRequest, syncPathVariables } from '../../apps/desktop/src/lib/url';

describe('URL ↔ params sync', () => {
  it('parses the query into params and keeps disabled rows', () => {
    expect(paramsFromUrl('{{baseUrl}}/pets?limit=10&q={{term}}&flag', [{ key: 'x', value: '1', enabled: false }])).toEqual([
      { key: 'limit', value: '10', enabled: true },
      { key: 'q', value: '{{term}}', enabled: true },
      { key: 'flag', value: '', enabled: true },
      { key: 'x', value: '1', enabled: false },
    ]);
  });
  it('rebuilds the URL from params', () => {
    expect(urlFromParams('https://a.test/p?old=1', [{ key: 'a', value: '1' }, { key: 'b', value: '2', enabled: false }])).toBe('https://a.test/p?a=1');
    expect(urlFromParams('https://a.test/p?old=1', [])).toBe('https://a.test/p');
  });
  it('round-trips engine requests', () => {
    const ui = fromEngineRequest({ method: 'GET', url: 'https://a.test/users/:id', params: [{ key: 'q', value: 'x' }] });
    expect(ui.url).toBe('https://a.test/users/:id?q=x');
    expect(ui.pathVariables).toEqual([{ key: 'id', value: '', enabled: true }]);
    expect(toEngineRequest(ui).url).toBe('https://a.test/users/:id');
  });
  it('syncs path variable rows with the URL', () => {
    expect(syncPathVariables('/a/:id/b/:x', [{ key: 'id', value: '7' }])).toEqual([{ key: 'id', value: '7' }, { key: 'x', value: '', enabled: true }]);
  });
});
