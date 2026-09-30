import { describe, it, expect } from 'vitest';
import { detectRequestSnippet, parseRequestSnippet, parseCurl, parseFetch, parsePowerShell, isRequestSnippet } from '../../packages/core/src/index.js';

describe('paste a devtools "Copy as …" snippet', () => {
  it('parses Chrome "Copy as cURL (cmd)" with caret escaping', () => {
    const cmd = [
      'curl ^"https://api.test/v1/pets?limit=10^&q=rex^" ^',
      '  -H ^"accept: application/json^" ^',
      '  -H ^"content-type: application/json^" ^',
      '  -H ^"cookie: sid=abc; theme=dark^" ^',
      '  --data-raw ^"^{^\\^"name^\\^":^\\^"Rex^\\^",^\\^"age^\\^":3^}^"',
    ].join('\r\n');
    expect(detectRequestSnippet(cmd)).toBe('curl');
    const r = parseCurl(cmd);
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.test/v1/pets');
    expect(r.params).toEqual([{ key: 'limit', value: '10' }, { key: 'q', value: 'rex' }]);
    expect(r.headers).toEqual([{ key: 'accept', value: 'application/json' }, { key: 'content-type', value: 'application/json' }]);
    expect(r.cookies).toEqual([{ key: 'sid', value: 'abc' }, { key: 'theme', value: 'dark' }]);
    expect(r.body).toEqual({ type: 'json', content: '{\n  "name": "Rex",\n  "age": 3\n}' });
  });

  it('parses Chrome "Copy as fetch"', () => {
    const js = `fetch("https://api.test/v1/pets", {
  "headers": {
    "accept": "*/*",
    "authorization": "Bearer tok123",
    "content-type": "application/json"
  },
  "referrer": "https://app.test/",
  "referrerPolicy": "strict-origin-when-cross-origin",
  "body": "{\\"name\\":\\"Rex\\"}",
  "method": "POST",
  "mode": "cors",
  "credentials": "include"
});`;
    expect(detectRequestSnippet(js)).toBe('fetch');
    const r = parseFetch(js);
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.test/v1/pets');
    expect(r.auth).toEqual({ type: 'bearer', token: 'tok123' });
    expect(r.headers).toContainEqual({ key: 'Referer', value: 'https://app.test/' });
    expect(r.body).toEqual({ type: 'json', content: '{\n  "name": "Rex"\n}' });
  });

  it('parses "Copy as fetch (Node.js)" and hand-written fetch calls', () => {
    const node = `fetch("https://api.test/v1/pets?page=2", {
  "headers": { "accept": "application/json" },
  "body": null,
  "method": "GET"
});`;
    const r = parseRequestSnippet(node);
    expect(r.method).toBe('GET');
    expect(r.params).toEqual([{ key: 'page', value: '2' }]);
    expect(r.body).toEqual({ type: 'none' });

    const hand = `await fetch('https://api.test/login', { method: 'post', headers: { 'Content-Type': 'application/json', }, body: JSON.stringify({ user: 'a' }), })`;
    const h = parseRequestSnippet(hand);
    expect(h.method).toBe('POST');
    expect(h.body).toEqual({ type: 'json', content: '{\n  "user": "a"\n}' });
    expect(parseRequestSnippet(`fetch("https://api.test/x")`).method).toBe('GET');
  });

  it('parses Chrome "Copy as PowerShell"', () => {
    const ps = [
      '$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession',
      '$session.UserAgent = "Mozilla/5.0 (Windows NT 10.0)"',
      '$session.Cookies.Add((New-Object System.Net.Cookie("sid", "abc", "/", "api.test")))',
      'Invoke-WebRequest -UseBasicParsing -Uri "https://api.test/v1/pets" `',
      '-Method "POST" `',
      '-WebSession $session `',
      '-Headers @{',
      '"authority"="api.test"',
      '  "method"="POST"',
      '  "path"="/v1/pets"',
      '  "scheme"="https"',
      '  "accept"="*/*"',
      '  "x-api-key"="k1"',
      '} `',
      '-ContentType "application/json" `',
      '-Body "{`"name`":`"Rex`"}"',
    ].join('\r\n');
    expect(detectRequestSnippet(ps)).toBe('powershell');
    const r = parsePowerShell(ps);
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.test/v1/pets');
    expect(r.headers).toEqual([
      { key: 'accept', value: '*/*' },
      { key: 'x-api-key', value: 'k1' },
      { key: 'Content-Type', value: 'application/json' },
      { key: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0)' },
    ]);
    expect(r.cookies).toEqual([{ key: 'sid', value: 'abc' }]);
    expect(r.body).toEqual({ type: 'json', content: '{\n  "name": "Rex"\n}' });
  });

  it('handles Invoke-RestMethod with a GET and no body', () => {
    const r = parseRequestSnippet(`Invoke-RestMethod -Uri 'https://api.test/a?x=1' -Headers @{ Authorization = 'Bearer t'; Accept = 'application/json' }`);
    expect(r.method).toBe('GET');
    expect(r.params).toEqual([{ key: 'x', value: '1' }]);
    expect(r.auth).toEqual({ type: 'bearer', token: 't' });
    expect(r.headers).toEqual([{ key: 'Accept', value: 'application/json' }]);
  });

  it('ignores plain URLs and other text', () => {
    expect(isRequestSnippet('https://api.test/a')).toBe(false);
    expect(isRequestSnippet('{{baseUrl}}/fetch(')).toBe(false);
    expect(isRequestSnippet('Get-ChildItem')).toBe(false);
    expect(() => parseRequestSnippet('hello')).toThrow();
  });
});

describe('paste an HTTPie (or xh) command', () => {
  it('reads method, URL, JSON fields, raw JSON, query, headers and auth', () => {
    const cmd = `http POST api.test/pets name=Rex age:=3 tags:='["dog"]' q==search 'Authorization:Bearer tok' -A bearer -a tok123`;
    expect(detectRequestSnippet(cmd)).toBe('httpie');
    const r = parseRequestSnippet(cmd);
    expect(r).toMatchObject({ method: 'POST', url: 'http://api.test/pets', params: [{ key: 'q', value: 'search' }], headers: [{ key: 'Authorization', value: 'Bearer tok' }], auth: { type: 'bearer', token: 'tok123' } });
    expect(JSON.parse((r.body as { content: string }).content)).toEqual({ name: 'Rex', age: 3, tags: ['dog'] });
  });

  it('forms, files, localhost shorthand, https and flags', () => {
    expect(parseRequestSnippet('http --form :3000/login user=vet password=paws')).toMatchObject({ method: 'POST', url: 'http://localhost:3000/login', body: { type: 'form-urlencoded', fields: [{ key: 'user', value: 'vet' }, { key: 'password', value: 'paws' }] } });
    expect(parseRequestSnippet('https -f PUT example.com/upload photo@./rex.png name=Rex')).toMatchObject({ method: 'PUT', url: 'https://example.com/upload', body: { type: 'multipart', fields: [{ key: 'photo', value: './rex.png', kind: 'file' }, { key: 'name', value: 'Rex', kind: 'text' }] } });
    expect(parseRequestSnippet('xh --verify=no --timeout 5 -a vet:paws localhost:8443/me')).toMatchObject({ method: 'GET', url: 'http://localhost:8443/me', auth: { type: 'basic', username: 'vet', password: 'paws' }, settings: { insecure: true, timeoutMs: 5000 } });
    expect(isRequestSnippet('http is a protocol')).toBe(false);
    expect(isRequestSnippet('https://api.test')).toBe(false);
  });
});
