/**
 * Code snippets for a prepared request (Postman's "Code" panel). The input is the request after
 * variable resolution and auth, so snippets run as-is. Secrets can be masked by the caller.
 */
export interface SnippetRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body?: string;
  /** multipart fields (files are referenced by path) */
  form?: Array<{ key: string; value: string; file?: boolean }>;
}

export interface CodeLanguage {
  id: string;
  label: string;
  /** Monaco language id for highlighting. */
  syntax: string;
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: 'curl', label: 'cURL (bash)', syntax: 'shell' },
  { id: 'curl-windows', label: 'cURL (Windows cmd)', syntax: 'bat' },
  { id: 'httpie', label: 'HTTPie', syntax: 'shell' },
  { id: 'powershell', label: 'PowerShell', syntax: 'powershell' },
  { id: 'fetch', label: 'JavaScript – fetch', syntax: 'javascript' },
  { id: 'axios', label: 'JavaScript – Axios', syntax: 'javascript' },
  { id: 'python', label: 'Python – requests', syntax: 'python' },
  { id: 'python-httpx', label: 'Python – httpx', syntax: 'python' },
  { id: 'go', label: 'Go – net/http', syntax: 'go' },
  { id: 'java', label: 'Java – OkHttp', syntax: 'java' },
  { id: 'java-httpclient', label: 'Java – HttpClient (11+)', syntax: 'java' },
  { id: 'kotlin', label: 'Kotlin – OkHttp', syntax: 'kotlin' },
  { id: 'dart', label: 'Dart – http', syntax: 'dart' },
  { id: 'csharp', label: 'C# – HttpClient', syntax: 'csharp' },
  { id: 'php', label: 'PHP – cURL', syntax: 'php' },
  { id: 'ruby', label: 'Ruby – Net::HTTP', syntax: 'ruby' },
  { id: 'rust', label: 'Rust – reqwest', syntax: 'rust' },
  { id: 'swift', label: 'Swift – URLSession', syntax: 'swift' },
  { id: 'raw', label: 'HTTP (raw)', syntax: 'http' },
];

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const dq = (s: string) => JSON.stringify(s);
/** A double-quoted string for Kotlin and Dart, where "$" starts an interpolation. */
const kq = (s: string) => dq(s).replace(/\$/g, '\\$');
const isJson = (r: SnippetRequest) => r.headers.some(([k, v]) => /^content-type$/i.test(k) && /json/i.test(v));
const hasBody = (r: SnippetRequest) => (r.body !== undefined && r.body !== '') || !!r.form?.length;
const skipHeader = (k: string) => /^(content-length|host)$/i.test(k);
const hdrs = (r: SnippetRequest) => r.headers.filter(([k]) => !skipHeader(k) && !(r.form && /^content-type$/i.test(k)));

/** A JSON body as a Python literal (True / False / None outside strings); undefined when it isn't JSON. */
function pyLiteral(body: string): string | undefined {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return undefined;
  }
  const lit = (x: unknown, pad: string): string => {
    if (x === null) return 'None';
    if (x === true) return 'True';
    if (x === false) return 'False';
    if (typeof x === 'number' || typeof x === 'string') return JSON.stringify(x);
    const inner = pad + '    ';
    if (Array.isArray(x)) return x.length ? `[\n${x.map((y) => inner + lit(y, inner)).join(',\n')}\n${pad}]` : '[]';
    const e = Object.entries(x as object);
    return e.length ? `{\n${e.map(([k, y]) => `${inner}${JSON.stringify(k)}: ${lit(y, inner)}`).join(',\n')}\n${pad}}` : '{}';
  };
  return lit(v, '');
}

function indentJson(body: string, pad: string): string {
  return body
    .split('\n')
    .map((l, i) => (i ? pad + l : l))
    .join('\n');
}

const generators: Record<string, (r: SnippetRequest) => string> = {
  curl(r) {
    const lines = [`curl --location --request ${r.method} ${sq(r.url)}`];
    for (const [k, v] of hdrs(r)) lines.push(`  --header ${sq(`${k}: ${v}`)}`);
    for (const f of r.form ?? []) lines.push(`  --form ${sq(`${f.key}=${f.file ? '@' : ''}${f.value}`)}`);
    if (r.body && !r.form) lines.push(`  --data-raw ${sq(r.body)}`);
    return lines.join(' \\\n');
  },
  'curl-windows'(r) {
    const esc = (s: string) => `"${s.replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
    const lines = [`curl --location --request ${r.method} ${esc(r.url)}`];
    for (const [k, v] of hdrs(r)) lines.push(`  --header ${esc(`${k}: ${v}`)}`);
    for (const f of r.form ?? []) lines.push(`  --form ${esc(`${f.key}=${f.file ? '@' : ''}${f.value}`)}`);
    if (r.body && !r.form) lines.push(`  --data-raw ${esc(r.body.replace(/\r?\n/g, ' '))}`);
    return lines.join(' ^\n');
  },
  httpie(r) {
    const parts = [`http ${r.method} ${sq(r.url)}`];
    for (const [k, v] of hdrs(r)) parts.push(sq(`${k}:${v}`));
    for (const f of r.form ?? []) parts.push(sq(`${f.key}${f.file ? '@' : '='}${f.value}`));
    const pre = r.body && !r.form ? `printf '%s' ${sq(r.body)} | ` : '';
    return pre + parts.join(' \\\n  ') + (r.form ? ' --multipart' : '');
  },
  powershell(r) {
    const lines = ['$headers = @{'];
    for (const [k, v] of hdrs(r)) lines.push(`    ${dq(k)} = ${dq(v)}`);
    lines.push('}');
    let call = `$response = Invoke-RestMethod -Uri ${dq(r.url)} -Method ${r.method} -Headers $headers`;
    if (r.form) {
      lines.push('$form = @{');
      for (const f of r.form) lines.push(`    ${dq(f.key)} = ${f.file ? `Get-Item ${dq(f.value)}` : dq(f.value)}`);
      lines.push('}');
      call += ' -Form $form';
    } else if (r.body) {
      lines.push(`$body = @'\n${r.body}\n'@`);
      call += ' -Body $body';
    }
    lines.push(call, '$response | ConvertTo-Json -Depth 10');
    return lines.join('\n');
  },
  fetch(r) {
    const opts: string[] = [`  method: ${dq(r.method)},`];
    const h = hdrs(r);
    if (h.length) opts.push(`  headers: {\n${h.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`).join('\n')}\n  },`);
    let pre = '';
    if (r.form) {
      pre = `const form = new FormData();\n${r.form.map((f) => (f.file ? `form.append(${dq(f.key)}, fileInput.files[0]); // ${f.value}` : `form.append(${dq(f.key)}, ${dq(f.value)});`)).join('\n')}\n\n`;
      opts.push('  body: form,');
    } else if (r.body) opts.push(`  body: ${isJson(r) ? `JSON.stringify(${indentJson(r.body, '  ')})` : dq(r.body)},`);
    return `${pre}const response = await fetch(${dq(r.url)}, {\n${opts.join('\n')}\n});\n\nconsole.log(response.status, await response.text());`;
  },
  axios(r) {
    const lines = ["import axios from 'axios';", '', 'const response = await axios.request({', `  method: ${dq(r.method.toLowerCase())},`, `  url: ${dq(r.url)},`];
    const h = hdrs(r);
    if (h.length) lines.push(`  headers: {\n${h.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`).join('\n')}\n  },`);
    if (r.body && !r.form) lines.push(`  data: ${isJson(r) ? indentJson(r.body, '  ') : dq(r.body)},`);
    lines.push('});', '', 'console.log(response.status, response.data);');
    return lines.join('\n');
  },
  python(r) {
    const lines = ['import requests', '', `url = ${dq(r.url)}`];
    const h = hdrs(r);
    lines.push(`headers = {${h.length ? '\n' + h.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`).join('\n') + '\n' : ''}}`);
    let args = 'url, headers=headers';
    if (r.form) {
      lines.push(`data = {${r.form.filter((f) => !f.file).map((f) => `${dq(f.key)}: ${dq(f.value)}`).join(', ')}}`);
      lines.push(`files = {${r.form.filter((f) => f.file).map((f) => `${dq(f.key)}: open(${dq(f.value)}, "rb")`).join(', ')}}`);
      args += ', data=data, files=files';
    } else if (r.body) {
      const py = isJson(r) ? pyLiteral(r.body) : undefined;
      if (py !== undefined) {
        lines.push(`payload = ${py}`);
        args += ', json=payload';
      } else {
        lines.push(`payload = ${dq(r.body)}`);
        args += ', data=payload';
      }
    }
    lines.push('', `response = requests.request(${dq(r.method)}, ${args})`, 'print(response.status_code, response.text)');
    return lines.join('\n');
  },
  'python-httpx'(r) {
    const lines = ['import httpx', '', `url = ${dq(r.url)}`];
    const h = hdrs(r);
    lines.push(`headers = {${h.length ? '\n' + h.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`).join('\n') + '\n' : ''}}`);
    let args = 'url, headers=headers';
    if (r.form) {
      lines.push(`data = {${r.form.filter((f) => !f.file).map((f) => `${dq(f.key)}: ${dq(f.value)}`).join(', ')}}`);
      lines.push(`files = {${r.form.filter((f) => f.file).map((f) => `${dq(f.key)}: open(${dq(f.value)}, "rb")`).join(', ')}}`);
      args += ', data=data, files=files';
    } else if (r.body) {
      const py = isJson(r) ? pyLiteral(r.body) : undefined;
      lines.push(`payload = ${py ?? dq(r.body)}`);
      args += py !== undefined ? ', json=payload' : ', content=payload';
    }
    lines.push('', 'with httpx.Client(follow_redirects=True) as client:', `    response = client.request(${dq(r.method)}, ${args})`, '    print(response.status_code, response.text)');
    return lines.join('\n');
  },
  go(r) {
    const body = r.body && !r.form;
    return [
      'package main',
      '',
      'import (',
      '\t"fmt"',
      '\t"io"',
      '\t"net/http"',
      body ? '\t"strings"' : '',
      ')',
      '',
      'func main() {',
      body ? `\tpayload := strings.NewReader(${'`'}${r.body!.replace(/`/g, '` + "`" + `')}${'`'})` : '',
      `\treq, err := http.NewRequest(${dq(r.method)}, ${dq(r.url)}, ${body ? 'payload' : 'nil'})`,
      '\tif err != nil {\n\t\tpanic(err)\n\t}',
      ...hdrs(r).map(([k, v]) => `\treq.Header.Add(${dq(k)}, ${dq(v)})`),
      '\tres, err := http.DefaultClient.Do(req)',
      '\tif err != nil {\n\t\tpanic(err)\n\t}',
      '\tdefer res.Body.Close()',
      '\tdata, _ := io.ReadAll(res.Body)',
      '\tfmt.Println(res.StatusCode, string(data))',
      '}',
    ]
      .filter((l) => l !== '')
      .join('\n');
  },
  java(r) {
    const ct = r.headers.find(([k]) => /^content-type$/i.test(k))?.[1] ?? 'text/plain';
    const lines = ['OkHttpClient client = new OkHttpClient();'];
    let body = 'null';
    if (r.form) {
      lines.push('RequestBody body = new MultipartBody.Builder().setType(MultipartBody.FORM)');
      for (const f of r.form)
        lines.push(f.file ? `  .addFormDataPart(${dq(f.key)}, ${dq(f.value)}, RequestBody.create(new File(${dq(f.value)}), null))` : `  .addFormDataPart(${dq(f.key)}, ${dq(f.value)})`);
      lines.push('  .build();');
      body = 'body';
    } else if (r.body) {
      lines.push(`RequestBody body = RequestBody.create(${dq(r.body)}, MediaType.parse(${dq(ct)}));`);
      body = 'body';
    } else if (/^(POST|PUT|PATCH)$/.test(r.method)) body = 'RequestBody.create(new byte[0])';
    lines.push('Request request = new Request.Builder()', `  .url(${dq(r.url)})`, `  .method(${dq(r.method)}, ${body})`);
    for (const [k, v] of hdrs(r)) lines.push(`  .addHeader(${dq(k)}, ${dq(v)})`);
    lines.push('  .build();', 'Response response = client.newCall(request).execute();', 'System.out.println(response.code() + " " + response.body().string());');
    return lines.join('\n');
  },
  'java-httpclient'(r) {
    const body = r.body && !r.form ? `HttpRequest.BodyPublishers.ofString(${dq(r.body)})` : 'HttpRequest.BodyPublishers.noBody()';
    const lines = [
      'import java.net.URI;',
      'import java.net.http.HttpClient;',
      'import java.net.http.HttpRequest;',
      'import java.net.http.HttpResponse;',
      '',
      'HttpClient client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build();',
      'HttpRequest request = HttpRequest.newBuilder()',
      `  .uri(URI.create(${dq(r.url)}))`,
      `  .method(${dq(r.method)}, ${body})`,
    ];
    // HttpClient sets these itself and refuses them
    for (const [k, v] of hdrs(r)) if (!/^(connection|expect|upgrade)$/i.test(k)) lines.push(`  .header(${dq(k)}, ${dq(v)})`);
    if (r.form) lines.push('  // multipart bodies: build them with a library such as Apache HttpClient 5 (MultipartEntityBuilder)');
    lines.push('  .build();', 'HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());', 'System.out.println(response.statusCode() + " " + response.body());');
    return lines.join('\n');
  },
  kotlin(r) {
    const ct = r.headers.find(([k]) => /^content-type$/i.test(k))?.[1] ?? 'text/plain';
    const lines = ['import okhttp3.*', 'import okhttp3.MediaType.Companion.toMediaType', 'import okhttp3.RequestBody.Companion.asRequestBody',
      'import okhttp3.RequestBody.Companion.toRequestBody', '', 'val client = OkHttpClient()'];
    let body = 'null';
    if (r.form) {
      lines.push('val body = MultipartBody.Builder().setType(MultipartBody.FORM)');
      for (const f of r.form) lines.push(f.file ? `  .addFormDataPart(${kq(f.key)}, ${kq(f.value)}, java.io.File(${kq(f.value)}).asRequestBody())` : `  .addFormDataPart(${kq(f.key)}, ${kq(f.value)})`);
      lines.push('  .build()');
      body = 'body';
    } else if (r.body) {
      lines.push(`val body = ${kq(r.body)}.toRequestBody(${kq(ct)}.toMediaType())`);
      body = 'body';
    } else if (/^(POST|PUT|PATCH)$/.test(r.method)) body = 'ByteArray(0).toRequestBody()';
    lines.push('val request = Request.Builder()', `  .url(${kq(r.url)})`, `  .method(${kq(r.method)}, ${body})`);
    for (const [k, v] of hdrs(r)) lines.push(`  .addHeader(${kq(k)}, ${kq(v)})`);
    lines.push('  .build()', 'client.newCall(request).execute().use { response ->', '  println("${response.code} ${response.body?.string()}")', '}');
    return lines.join('\n');
  },
  dart(r) {
    const lines = ["import 'package:http/http.dart' as http;", '', 'Future<void> main() async {'];
    const h = hdrs(r);
    if (r.form) {
      lines.push(`  final request = http.MultipartRequest(${kq(r.method)}, Uri.parse(${kq(r.url)}));`);
      for (const f of r.form) lines.push(f.file ? `  request.files.add(await http.MultipartFile.fromPath(${kq(f.key)}, ${kq(f.value)}));` : `  request.fields[${kq(f.key)}] = ${kq(f.value)};`);
    } else {
      lines.push(`  final request = http.Request(${kq(r.method)}, Uri.parse(${kq(r.url)}));`);
      if (r.body) lines.push(`  request.body = ${kq(r.body)};`);
    }
    for (const [k, v] of h) lines.push(`  request.headers[${kq(k)}] = ${kq(v)};`);
    lines.push('  final response = await http.Response.fromStream(await request.send());', "  print('${response.statusCode} ${response.body}');", '}');
    return lines.join('\n');
  },
  csharp(r) {
    const ct = r.headers.find(([k]) => /^content-type$/i.test(k))?.[1] ?? 'text/plain';
    const lines = ['using var client = new HttpClient();', `var request = new HttpRequestMessage(new HttpMethod(${dq(r.method)}), ${dq(r.url)});`];
    for (const [k, v] of hdrs(r)) if (!/^content-type$/i.test(k)) lines.push(`request.Headers.TryAddWithoutValidation(${dq(k)}, ${dq(v)});`);
    if (r.form) {
      lines.push('var content = new MultipartFormDataContent();');
      for (const f of r.form) lines.push(f.file ? `content.Add(new StreamContent(File.OpenRead(${dq(f.value)})), ${dq(f.key)}, ${dq(f.value)});` : `content.Add(new StringContent(${dq(f.value)}), ${dq(f.key)});`);
      lines.push('request.Content = content;');
    } else if (r.body) lines.push(`request.Content = new StringContent(${dq(r.body)}, System.Text.Encoding.UTF8, ${dq(ct.split(';')[0]!)});`);
    lines.push('var response = await client.SendAsync(request);', 'Console.WriteLine($"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");');
    return lines.join('\n');
  },
  php(r) {
    const opts = [
      `  CURLOPT_URL => ${dq(r.url)},`,
      '  CURLOPT_RETURNTRANSFER => true,',
      '  CURLOPT_FOLLOWLOCATION => true,',
      `  CURLOPT_CUSTOMREQUEST => ${dq(r.method)},`,
    ];
    if (r.form) opts.push(`  CURLOPT_POSTFIELDS => [${r.form.map((f) => `${dq(f.key)} => ${f.file ? `new CURLFile(${dq(f.value)})` : dq(f.value)}`).join(', ')}],`);
    else if (r.body) opts.push(`  CURLOPT_POSTFIELDS => ${dq(r.body)},`);
    const h = hdrs(r);
    if (h.length) opts.push(`  CURLOPT_HTTPHEADER => [\n${h.map(([k, v]) => `    ${dq(`${k}: ${v}`)},`).join('\n')}\n  ],`);
    return `<?php\n$curl = curl_init();\ncurl_setopt_array($curl, [\n${opts.join('\n')}\n]);\n$response = curl_exec($curl);\ncurl_close($curl);\necho $response;`;
  },
  ruby(r) {
    const cls = r.method.charAt(0) + r.method.slice(1).toLowerCase();
    const lines = ["require 'net/http'", "require 'uri'", '', `url = URI(${dq(r.url)})`, 'http = Net::HTTP.new(url.host, url.port)', "http.use_ssl = url.scheme == 'https'", `request = Net::HTTP::${/^(Get|Post|Put|Patch|Delete|Head|Options)$/.test(cls) ? cls : 'Get'}.new(url)`];
    for (const [k, v] of hdrs(r)) lines.push(`request[${dq(k)}] = ${dq(v)}`);
    if (r.body && !r.form) lines.push(`request.body = ${dq(r.body)}`);
    lines.push('response = http.request(request)', 'puts response.code, response.read_body');
    return lines.join('\n');
  },
  rust(r) {
    const lines = ['let client = reqwest::Client::new();', `let response = client.request(reqwest::Method::from_bytes(b${dq(r.method)})?, ${dq(r.url)})`];
    for (const [k, v] of hdrs(r)) lines.push(`    .header(${dq(k)}, ${dq(v)})`);
    if (r.body && !r.form) lines.push(`    .body(${dq(r.body)})`);
    lines.push('    .send()', '    .await?;', 'println!("{} {}", response.status(), response.text().await?);');
    return lines.join('\n');
  },
  swift(r) {
    const lines = ['import Foundation', '', `var request = URLRequest(url: URL(string: ${dq(r.url)})!)`, `request.httpMethod = ${dq(r.method)}`];
    for (const [k, v] of hdrs(r)) lines.push(`request.addValue(${dq(v)}, forHTTPHeaderField: ${dq(k)})`);
    if (r.body && !r.form) lines.push(`request.httpBody = ${dq(r.body)}.data(using: .utf8)`);
    lines.push('', 'let (data, response) = try await URLSession.shared.data(for: request)', 'print((response as! HTTPURLResponse).statusCode, String(data: data, encoding: .utf8)!)');
    return lines.join('\n');
  },
  raw(r) {
    const u = new URL(r.url);
    const lines = [`${r.method} ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`, ...hdrs(r).map(([k, v]) => `${k}: ${v}`)];
    if (r.form) lines.push('Content-Type: multipart/form-data; boundary=----TestPionBoundary', '', ...r.form.flatMap((f) => ['------TestPionBoundary', `Content-Disposition: form-data; name="${f.key}"${f.file ? `; filename="${f.value}"` : ''}`, '', f.file ? '<file contents>' : f.value]), '------TestPionBoundary--');
    else if (hasBody(r)) lines.push('', r.body!);
    return lines.join('\n');
  },
};

export function generateCode(r: SnippetRequest, language: string): string {
  const g = generators[language];
  if (!g) throw new Error(`Unknown code language ${language}`);
  return g(r);
}
