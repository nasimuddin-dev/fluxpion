/** The request editor: params, auth, headers, body, cookies, scripts, tests, examples, docs and settings. */
import { useState } from 'react';
import { useApp } from '../../store';
import type { BodyConfig, HttpRequestSpec, KeyValue, SavedExample } from '../../types';
import { ExamplesPanel } from '../../components/ExamplesPanel';
import { Markdown } from '../../components/Markdown';
import { ScriptsPanel } from '../../components/ScriptsPanel';

import { AssertionEditor } from '../../components/AssertionEditor';
import { AuthEditor } from '../../components/AuthEditor';
import { CodeEditor } from '../../components/CodeEditor';
import { COMMON_HEADERS, HEADER_VALUES, KeyValueEditor } from '../../components/KeyValueEditor';
import { Field, Input, Tabs, Toggle } from '../../components/ui';
import { RestTab } from './types';

export function RequestEditor({
  tab,
  update,
  setReq,
  setParams,
  setExamples,
}: {
  tab: RestTab;
  update(p: Partial<RestTab>): void;
  setReq(p: Partial<HttpRequestSpec>): void;
  setParams(p: KeyValue[]): void;
  setExamples(e: SavedExample[]): void;
}) {
  const [sub, setSub] = useState<'params' | 'auth' | 'headers' | 'body' | 'cookies' | 'scripts' | 'tests' | 'examples' | 'docs' | 'settings'>('params');
  const r = tab.request;
  const count = (a?: Array<{ enabled?: boolean }>) => a?.filter((x) => x.enabled !== false).length || undefined;
  return (
    <div className="h-full flex flex-col min-h-0">
      <Tabs
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'params', label: 'Params', badge: count(r.params) },
          { id: 'auth', label: 'Authorization' },
          { id: 'headers', label: 'Headers', badge: count(r.headers) },
          { id: 'body', label: 'Body', badge: r.body && r.body.type !== 'none' ? r.body.type : undefined },
          { id: 'cookies', label: 'Cookies', badge: count(r.cookies) },
          { id: 'scripts', label: 'Scripts', badge: (tab.preRequestScript ? 1 : 0) + (tab.testScript ? 1 : 0) || undefined },
          { id: 'tests', label: 'Tests', badge: tab.assertions.length || undefined },
          { id: 'examples', label: 'Examples', badge: tab.examples?.length || undefined },
          { id: 'docs', label: 'Docs', badge: tab.description?.trim() ? '•' : undefined },
          { id: 'settings', label: 'Settings' },
        ]}
        right={
          <input
            aria-label="Request name"
            className="bg-transparent text-sm text-muted text-right outline-none focus:text-fg w-48"
            value={tab.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        }
      />
      <div className="flex-1 min-h-0 overflow-auto">
        {sub === 'params' && (
          <div className="p-2">
            <div className="text-xs font-semibold text-muted px-1 pb-1">Query Params</div>
            <KeyValueEditor rows={r.params ?? []} onChange={setParams} keyPlaceholder="Key" bulkEdit />
            {!!r.pathVariables?.length && (
              <>
                <div className="text-xs font-semibold text-muted px-1 pt-4 pb-1">Path Variables</div>
                <KeyValueEditor rows={r.pathVariables} onChange={(pathVariables) => setReq({ pathVariables: pathVariables.filter((v) => r.pathVariables!.some((x) => x.key === v.key)) })} keyPlaceholder="Key" fixedKeys />
              </>
            )}
            <p className="text-xs text-muted px-2 pt-3">
              The query string in the URL bar and this table stay in sync. Use <span className="mono">/:name</span> in the path for path variables. Values may use {'{{variables}}'}.
            </p>
          </div>
        )}
        {sub === 'auth' && <AuthEditor auth={r.auth} onChange={(auth) => setReq({ auth })} />}
        {sub === 'headers' && (
          <div className="p-2">
            <KeyValueEditor rows={r.headers ?? []} onChange={(headers) => setReq({ headers })} keyPlaceholder="Header" suggestions={COMMON_HEADERS} valueSuggestions={HEADER_VALUES} />
          </div>
        )}
        {sub === 'body' && <BodyEditor body={r.body ?? { type: 'none' }} onChange={(body) => setReq({ body })} />}
        {sub === 'cookies' && (
          <div className="p-2">
            <KeyValueEditor rows={r.cookies ?? []} onChange={(cookies) => setReq({ cookies })} keyPlaceholder="Cookie" />
            <p className="text-xs text-muted px-1 pt-2">
              Matching cookies from the workspace cookie jar are added automatically; cookies here win when the name is the same. Use the cookie button next to Send to see or edit the jar.
            </p>
          </div>
        )}
        {sub === 'scripts' && <ScriptsPanel pre={tab.preRequestScript ?? ''} post={tab.testScript ?? ''} onPre={(v) => update({ preRequestScript: v })} onPost={(v) => update({ testScript: v })} />}
        {sub === 'docs' && <DocsEditor value={tab.description ?? ''} onChange={(description) => update({ description })} />}
        {sub === 'examples' && <ExamplesPanel key={tab.id} collectionId={tab.collectionId} requestId={tab.requestId} examples={tab.examples ?? []} onChange={setExamples} />}
        {sub === 'tests' && <AssertionEditor checks={tab.assertions} onChange={(assertions) => update({ assertions })} groups={['Response', 'Body']} />}
        {sub === 'settings' && (
          <div className="p-4 grid grid-cols-2 gap-4 max-w-2xl text-sm">
            <Field label="Timeout (ms)">
              <Input type="number" value={r.settings?.timeoutMs ?? ''} placeholder="default from Settings" onChange={(e) => setReq({ settings: { ...r.settings, timeoutMs: e.target.value ? Number(e.target.value) : undefined } })} />
            </Field>
            <Field label="Retries" hint="On network errors, timeouts, 429 and 5xx; POST and PATCH only when the connection failed">
              <Input type="number" min={0} max={5} value={r.settings?.retries ?? ''} placeholder="0" onChange={(e) => setReq({ settings: { ...r.settings, retries: e.target.value ? Math.min(5, Math.max(0, Number(e.target.value))) : undefined } })} />
            </Field>
            <Field label="First retry after (ms)" hint="Doubles each time, at most 10 s; a Retry-After header wins">
              <Input type="number" min={0} value={r.settings?.retryDelayMs ?? ''} placeholder="500" onChange={(e) => setReq({ settings: { ...r.settings, retryDelayMs: e.target.value ? Number(e.target.value) : undefined } })} />
            </Field>
            <Field label="Proxy URL">
              <Input value={r.settings?.proxy ?? ''} placeholder="http://proxy:8080" onChange={(e) => setReq({ settings: { ...r.settings, proxy: e.target.value || undefined } })} />
            </Field>
            <Toggle checked={r.settings?.followRedirects !== false} onChange={(v) => setReq({ settings: { ...r.settings, followRedirects: v } })} label="Follow redirects" />
            <Toggle checked={!!r.settings?.insecure} onChange={(v) => setReq({ settings: { ...r.settings, insecure: v } })} label="Disable TLS verification (development only)" />
            <Toggle checked={!!r.settings?.http1Only} onChange={(v) => setReq({ settings: { ...r.settings, http1Only: v || undefined } })} label="HTTP/1.1 only (HTTP/2 is used over https when the server supports it)" />
            <div className="col-span-2 font-medium pt-2">Client certificate (mTLS)</div>
            <Field label="Certificate path (PEM)">
              <Input className="mono" value={r.settings?.clientCert?.certPath ?? ''} onChange={(e) => setReq({ settings: { ...r.settings, clientCert: e.target.value ? { certPath: e.target.value, keyPath: r.settings?.clientCert?.keyPath ?? '' } : undefined } })} />
            </Field>
            <Field label="Key path (PEM)">
              <Input className="mono" value={r.settings?.clientCert?.keyPath ?? ''} onChange={(e) => setReq({ settings: { ...r.settings, clientCert: { certPath: r.settings?.clientCert?.certPath ?? '', keyPath: e.target.value } } })} />
            </Field>
            <Field label="CA path (optional)">
              <Input className="mono" value={r.settings?.clientCert?.caPath ?? ''} onChange={(e) => setReq({ settings: { ...r.settings, clientCert: { certPath: r.settings?.clientCert?.certPath ?? '', keyPath: r.settings?.clientCert?.keyPath ?? '', caPath: e.target.value } } })} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

/** Pretty-print JSON (keeping {{variables}} intact) or indent XML. */
export function beautify(text: string, type: string): string {
  if (type === 'json') {
    // protect unquoted {{vars}} so the JSON parses, then restore them
    const vars: string[] = [];
    const safe = text.replace(/\{\{[^{}]+\}\}/g, (m) => `"__VAR${vars.push(m) - 1}__"`);
    try {
      return JSON.stringify(JSON.parse(safe), null, 2).replace(/"__VAR(\d+)__"/g, (_, i) => vars[Number(i)]!);
    } catch {
      useApp.getState().toast('The body is not valid JSON', 'error');
      return text;
    }
  }
  let depth = 0;
  return text
    .replace(/>\s*</g, '>\n<')
    .split('\n')
    .map((line) => {
      const l = line.trim();
      if (/^<\//.test(l)) depth = Math.max(0, depth - 1);
      const out = '  '.repeat(depth) + l;
      if (/^<[^!?/][^>]*[^/]>$/.test(l) && !/<\/[^>]+>$/.test(l)) depth++;
      return out;
    })
    .join('\n');
}

export function BodyEditor({ body, onChange }: { body: BodyConfig; onChange(b: BodyConfig): void }) {
  const types: Array<[BodyConfig['type'], string]> = [
    ['none', 'None'],
    ['json', 'JSON'],
    ['xml', 'XML'],
    ['text', 'Text'],
    ['html', 'HTML'],
    ['form-urlencoded', 'Form URL-encoded'],
    ['multipart', 'Multipart form'],
    ['binary', 'Binary file'],
  ];
  const setType = (t: BodyConfig['type']) => {
    if (t === 'none') return onChange({ type: 'none' });
    if (t === 'form-urlencoded' || t === 'multipart') return onChange({ type: t, fields: 'fields' in body ? body.fields : [] });
    if (t === 'binary') return onChange({ type: 'binary', filePath: '' });
    onChange({ type: t, content: 'content' in body ? body.content : t === 'json' ? '{\n  \n}' : '' });
  };
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex gap-3 px-3 py-1.5 text-sm flex-wrap items-center border-b border-line">
        {(body.type === 'json' || body.type === 'xml') && (
          <button className="order-last ml-auto text-xs text-accent hover:underline" onClick={() => onChange({ ...body, content: beautify(body.content, body.type) })}>
            Beautify
          </button>
        )}
        {types.map(([t, label]) => (
          <label key={t} className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="body-type" checked={body.type === t} onChange={() => setType(t)} />
            {label}
          </label>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {body.type === 'none' && <div className="p-4 text-sm text-muted">This request has no body.</div>}
        {'content' in body && <CodeEditor language={body.type === 'json' ? 'json' : body.type === 'xml' ? 'xml' : body.type === 'html' ? 'html' : 'plaintext'} value={body.content} onChange={(content) => onChange({ ...body, content })} />}
        {(body.type === 'form-urlencoded' || body.type === 'multipart') && (
          <div className="p-2 overflow-auto h-full">
            <KeyValueEditor rows={body.fields} onChange={(fields) => onChange({ ...body, fields })} keyPlaceholder="Field" allowFile={body.type === 'multipart'} />
          </div>
        )}
        {body.type === 'binary' && (
          <div className="p-4 flex flex-col gap-3 max-w-xl">
            <Field label="File path" hint="The file is streamed from disk when the request is sent.">
              <Input className="mono" value={body.filePath} onChange={(e) => onChange({ ...body, filePath: e.target.value })} />
            </Field>
            <Field label="Content-Type">
              <Input value={body.contentType ?? ''} placeholder="application/octet-stream" onChange={(e) => onChange({ ...body, contentType: e.target.value || undefined })} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

/** Request documentation: Markdown source and a live preview side by side. */
export function DocsEditor({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <div className="h-full grid grid-cols-2 gap-3 p-2 min-h-0">
      <textarea
        className="field h-full resize-none mono text-sm"
        placeholder={'Document this request in Markdown: what it does, required parameters, error cases…'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Request documentation (Markdown)"
      />
      <div className="overflow-auto border border-line rounded-md p-3">
        {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-muted">The preview appears here. The collection’s Docs tab shows the documentation of every request.</p>}
      </div>
    </div>
  );
}
