import { describe, expect, it } from 'vitest';
import { parseCurl, shellSplit, isCurlCommand, generateCode, grpcurlCommand, parseGrpcurl, CODE_LANGUAGES, buildUrl, pathVariableNames, applyPathVariables } from '../../packages/core/src/index.js';

describe('cURL import', () => {
  it('splits shell arguments with quotes, escapes and continuations', () => {
    const cmd = "curl -H 'a: b c' \"x \\\"y\\\"\" \\" + '\n' + "  --data $'l1\\nl2'";
    expect(shellSplit(cmd)).toEqual(['curl', '-H', 'a: b c', 'x "y"', '--data', 'l1\nl2']);
  });

  it('parses a browser "Copy as cURL" command', () => {
    const r = parseCurl(`curl 'https://api.test/v1/pets?limit=10&q=rex%20dog' \
      -H 'accept: application/json' \
      -H 'authorization: Bearer tok123' \
      -H 'content-type: application/json' \
      -b 'sid=abc; theme=dark' \
      --data-raw '{"name":"Rex"}' \
      --compressed`);
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.test/v1/pets');
    expect(r.params).toEqual([{ key: 'limit', value: '10' }, { key: 'q', value: 'rex dog' }]);
    expect(r.auth).toEqual({ type: 'bearer', token: 'tok123' });
    expect(r.headers?.map((h) => h.key)).toEqual(['accept', 'content-type']);
    expect(r.cookies).toEqual([{ key: 'sid', value: 'abc' }, { key: 'theme', value: 'dark' }]);
    expect(r.body).toEqual({ type: 'json', content: '{\n  "name": "Rex"\n}' });
  });

  it('parses methods, basic auth, forms and flags', () => {
    expect(parseCurl('curl -X DELETE -u user:pw https://x.test/a -k').auth).toEqual({ type: 'basic', username: 'user', password: 'pw' });
    expect(parseCurl('curl -X DELETE https://x.test/a -k').settings).toEqual({ insecure: true });
    const f = parseCurl(`curl https://x.test/upload -F 'file=@/tmp/a.png' -F 'name=pic'`);
    expect(f.body).toEqual({ type: 'multipart', fields: [{ key: 'file', value: '/tmp/a.png', kind: 'file' }, { key: 'name', value: 'pic', kind: 'text' }] });
    const u = parseCurl(`curl https://x.test/token -d 'grant_type=client_credentials&scope=a%20b'`);
    expect(u.body).toEqual({ type: 'form-urlencoded', fields: [{ key: 'grant_type', value: 'client_credentials' }, { key: 'scope', value: 'a b' }] });
    expect(parseCurl('curl -G https://x.test/s -d q=1').params).toEqual([{ key: 'q', value: '1' }]);
    expect(parseCurl('curl --json \'{"a":1}\' https://x.test').headers).toEqual([{ key: 'Content-Type', value: 'application/json' }, { key: 'Accept', value: 'application/json' }]);
    expect(isCurlCommand('curl https://a')).toBe(true);
    expect(isCurlCommand('https://a')).toBe(false);
    expect(() => parseCurl('curl -H x')).toThrow();
  });
});

describe('code generation', () => {
  const req = { method: 'POST', url: 'https://api.test/pets?x=1', headers: [['Content-Type', 'application/json'], ['X-Id', "it's"]] as Array<[string, string]>, body: '{\n  "name": "Rex",\n  "ok": true\n}' };
  it('generates every language', () => {
    for (const l of CODE_LANGUAGES) {
      const code = generateCode(req, l.id);
      expect(code.length, l.id).toBeGreaterThan(20);
      expect(code, l.id).toContain('api.test');
    }
  });
  it('escapes and formats correctly', () => {
    // POSIX single-quote escaping: it's → 'it'\''s'
    expect(generateCode(req, 'curl')).toContain("--header 'X-Id: it'\\''s'");
    expect(generateCode(req, 'python')).toContain('"ok": True');
    // JSON → Python: only real booleans / nulls change, never text inside strings
    const jsonReq = { method: 'POST', url: 'https://api.test/x', headers: [['Content-Type', 'application/json']] as Array<[string, string]>, body: '{"note":"is true, not null","n":null,"list":[false]}' };
    const py = generateCode(jsonReq, 'python-httpx');
    expect(py).toContain('"note": "is true, not null"');
    expect(py).toContain('"n": None');
    expect(py).toContain('json=payload');
    // Kotlin and Dart interpolate "$" in strings
    const dollar = { method: 'GET', url: 'https://api.test/$price', headers: [['X-Key', 'a$b']] as Array<[string, string]> };
    expect(generateCode(dollar, 'kotlin')).toContain('.url("https://api.test/\\$price")');
    expect(generateCode(dollar, 'dart')).toContain('request.headers["X-Key"] = "a\\$b";');
    expect(generateCode(jsonReq, 'java-httpclient')).toContain('HttpRequest.BodyPublishers.ofString(');
    // gRPC: grpcurl
    expect(grpcurlCommand({ target: 'localhost:50051', method: 'vet.v1.Patients/GetPatient', message: '{\n "id": "7"\n}', metadata: [{ key: 'authorization', value: "Bearer it's" }], protoFiles: ['vet.proto'], timeoutMs: 5000 })).toBe(
      `grpcurl -plaintext -proto 'vet.proto' -H 'authorization: Bearer it'\\''s' -max-time 5 -d '{"id":"7"}' 'localhost:50051' 'vet.v1.Patients/GetPatient'`,
    );
    expect(grpcurlCommand({ target: 'grpcs://api.test:443', method: '/svc.S/M', message: '{}' })).toBe(`grpcurl 'api.test:443' 'svc.S/M'`);
    // and back: paste a grpcurl command into the gRPC view
    const cmd = grpcurlCommand({ target: 'localhost:50051', method: 'vet.v1.Patients/GetPatient', message: '{"id":"7"}', metadata: [{ key: 'authorization', value: "Bearer it's" }], protoFiles: ['vet.proto'], timeoutMs: 5000 });
    expect(parseGrpcurl(cmd)).toEqual({ target: 'localhost:50051', method: 'vet.v1.Patients/GetPatient', message: '{\n  "id": "7"\n}', metadata: [{ key: 'authorization', value: "Bearer it's" }], tls: false, protoFiles: ['vet.proto'], timeoutMs: 5000 });
    expect(parseGrpcurl('grpcurl -d \'{"a":1}\' api.test:443 svc.S.M')).toMatchObject({ target: 'grpcs://api.test:443', method: 'svc.S/M', tls: true });
    expect(() => parseGrpcurl('curl x')).toThrow(/Not a grpcurl/);
    expect(generateCode(req, 'fetch')).toContain('body: JSON.stringify({');
    expect(generateCode(req, 'raw').split('\n')[0]).toBe('POST /pets?x=1 HTTP/1.1');
    expect(generateCode({ method: 'POST', url: 'https://a.test/u', headers: [], form: [{ key: 'f', value: '/a.png', file: true }] }, 'curl')).toContain(`--form 'f=@/a.png'`);
  });
});

describe('path variables', () => {
  it('finds and substitutes :name segments but not ports or schemes', () => {
    expect(pathVariableNames('https://api.test:8443/users/:id/posts/:postId?x=:no')).toEqual(['id', 'postId']);
    expect(applyPathVariables('https://api.test:8443/users/:id/x', [{ key: 'id', value: 'a b' }])).toBe('https://api.test:8443/users/a%20b/x');
    expect(buildUrl('localhost:3000/users/:id', [{ key: 'q', value: '1' }], [{ key: 'id', value: '7' }]).toString()).toBe('http://localhost:3000/users/7?q=1');
    expect(applyPathVariables('/a/:missing', [{ key: 'id', value: '1' }])).toBe('/a/:missing');
  });
});
