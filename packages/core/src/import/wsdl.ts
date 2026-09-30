import { XMLParser } from 'fast-xml-parser';
import { ApsError } from '../errors.js';
import type { Collection, CollectionFolder, KeyValue, SavedHttpRequest } from '../model/types.js';
import { SCHEMA_VERSION } from '../model/types.js';
import { shortId, slugify } from '../util/ids.js';

/**
 * WSDL 1.1 → a collection of SOAP requests, like Postman's WSDL import: a folder per SOAP port
 * (SOAP 1.1 and 1.2), a POST per operation with its SOAPAction and a sample envelope built from the
 * XML Schema in <types>. Imported (xsd:import) schemas are not fetched.
 */

type X = Record<string, any>;

const SOAP11 = 'http://schemas.xmlsoap.org/wsdl/soap/';
const SOAP12 = 'http://schemas.xmlsoap.org/wsdl/soap12/';
const ENVELOPE = { 11: 'http://schemas.xmlsoap.org/soap/envelope/', 12: 'http://www.w3.org/2003/05/soap-envelope' } as const;

export function isWsdl(text: string): boolean {
  const head = text.slice(0, 4000);
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<([\w-]+:)?definitions[\s>]/.test(head) && /schemas\.xmlsoap\.org\/wsdl\//.test(head);
}

const local = (q: unknown) => String(q ?? '').split(':').pop()!;

export function importWsdl(text: string): { collection: Collection } {
  let doc: X;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, parseAttributeValue: false, trimValues: true, isArray: (_n, _p, _leaf, isAttr) => !isAttr }).parse(text) as X;
  } catch (e) {
    throw new ApsError('ValidationError', `The WSDL is not valid XML: ${(e as Error).message}`);
  }
  // prefix → namespace, from every xmlns declaration in the document
  const prefixes = new Map<string, string>();
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n as X)) {
      if (k === '@xmlns') prefixes.set('', String(v));
      else if (k.startsWith('@xmlns:')) prefixes.set(k.slice(7), String(v));
      else if (!k.startsWith('@')) walk(v);
    }
  };
  walk(doc);
  const nsOf = (tag: string) => prefixes.get(tag.includes(':') ? tag.split(':')[0]! : '');
  const kids = (n: X | undefined, name: string, ns?: string): X[] =>
    n ? Object.entries(n).filter(([k]) => !k.startsWith('@') && k !== '#text' && local(k) === name && (!ns || nsOf(k) === ns)).flatMap(([, v]) => (Array.isArray(v) ? v : [v])) : [];
  const docOf = (n: X | undefined) => {
    const d = kids(n, 'documentation')[0];
    const t = typeof d === 'string' ? d : d?.['#text'];
    return t ? String(t).trim() : undefined;
  };

  const root = kids(doc, 'definitions')[0];
  if (!root) {
    if (kids(doc, 'description')[0]) throw new ApsError('ValidationError', 'WSDL 2.0 is not supported yet', { suggestions: ['Most services also publish a WSDL 1.1 document (often at ?wsdl).'] });
    throw new ApsError('ValidationError', 'Not a WSDL document (no <definitions>)');
  }
  const targetNs = String(root['@targetNamespace'] ?? '');

  // XML Schema: elements, complex and simple types by name (with their schema, for the namespace)
  const schemas = kids(kids(root, 'types')[0], 'schema');
  const elements = new Map<string, { node: X; schema: X }>();
  const complexTypes = new Map<string, { node: X; schema: X }>();
  const simpleTypes = new Map<string, X>();
  for (const s of schemas) {
    for (const e of kids(s, 'element')) elements.set(String(e['@name']), { node: e, schema: s });
    for (const c of kids(s, 'complexType')) complexTypes.set(String(c['@name']), { node: c, schema: s });
    for (const t of kids(s, 'simpleType')) simpleTypes.set(String(t['@name']), t);
  }
  const nsPrefix = new Map<string, string>();
  const prefixFor = (ns: string) => {
    if (!nsPrefix.has(ns)) nsPrefix.set(ns, nsPrefix.size === 0 ? 'tns' : `ns${nsPrefix.size}`);
    return nsPrefix.get(ns)!;
  };

  const placeholder = (type: string): string => {
    const t = local(type);
    const simple = simpleTypes.get(t);
    if (simple) {
      const r = kids(simple, 'restriction')[0];
      const first = kids(r, 'enumeration')[0];
      return first ? String(first['@value']) : placeholder(String(r?.['@base'] ?? 'string'));
    }
    if (/^(int|integer|long|short|byte|decimal|double|float|unsignedInt|unsignedLong|unsignedShort|unsignedByte|positiveInteger|nonNegativeInteger|negativeInteger|nonPositiveInteger)$/.test(t)) return '0';
    if (t === 'boolean') return 'false';
    if (t === 'dateTime') return '2024-01-01T00:00:00';
    if (t === 'date') return '2024-01-01';
    if (t === 'time') return '00:00:00';
    return '?';
  };

  /** Child elements of a complex type, as XML lines. */
  const complexBody = (ct: X, schema: X, indent: string, depth: number, seen: Set<string>): string[] => {
    const out: string[] = [];
    const ext = kids(kids(ct, 'complexContent')[0], 'extension')[0] ?? kids(kids(ct, 'complexContent')[0], 'restriction')[0];
    if (ext) {
      const base = complexTypes.get(local(ext['@base']));
      if (base && !seen.has(local(ext['@base']))) out.push(...complexBody(base.node, base.schema, indent, depth, new Set([...seen, local(ext['@base'])])));
      out.push(...complexBody(ext, schema, indent, depth, seen));
      return out;
    }
    const simpleContent = kids(ct, 'simpleContent')[0];
    if (simpleContent) return out;
    for (const group of [...kids(ct, 'sequence'), ...kids(ct, 'all'), ...kids(ct, 'choice')]) {
      const isChoice = kids(ct, 'choice').includes(group);
      const items = kids(group, 'element');
      for (const e of isChoice ? items.slice(0, 1) : items) out.push(...elementXml(e, schema, indent, depth, seen, false));
      for (const inner of [...kids(group, 'sequence'), ...kids(group, 'choice')]) out.push(...complexBody({ sequence: [inner] }, schema, indent, depth, seen));
    }
    return out;
  };

  /** An element (from a schema) as XML lines with sample content. */
  const elementXml = (e: X, schema: X, indent: string, depth: number, seen: Set<string>, topLevel: boolean): string[] => {
    if (e['@ref']) {
      const r = elements.get(local(e['@ref']));
      return r ? elementXml(r.node, r.schema, indent, depth, seen, true) : [];
    }
    const name = String(e['@name'] ?? 'element');
    const qualified = topLevel || schema['@elementFormDefault'] === 'qualified';
    const tag = qualified ? `${prefixFor(String(schema['@targetNamespace'] ?? targetNs))}:${name}` : name;
    const inline = kids(e, 'complexType')[0];
    const typeName = e['@type'] ? local(e['@type']) : undefined;
    const ct = inline ? { node: inline, schema } : typeName ? complexTypes.get(typeName) : undefined;
    if (!ct) {
      const simpleInline = kids(e, 'simpleType')[0];
      const value = simpleInline ? placeholder(String(kids(simpleInline, 'restriction')[0]?.['@base'] ?? 'string')) : placeholder(String(e['@type'] ?? 'string'));
      return [`${indent}<${tag}>${value}</${tag}>`];
    }
    const key = typeName ?? `${name}#inline`;
    if (depth > 8 || seen.has(key)) return [`${indent}<${tag}/>`];
    const body = complexBody(ct.node, ct.schema, `${indent}  `, depth + 1, new Set([...seen, key]));
    return body.length ? [`${indent}<${tag}>`, ...body, `${indent}</${tag}>`] : [`${indent}<${tag}/>`];
  };

  const messages = new Map<string, X[]>();
  for (const m of kids(root, 'message')) messages.set(String(m['@name']), kids(m, 'part'));
  const portTypes = new Map<string, Map<string, X>>();
  for (const pt of kids(root, 'portType')) portTypes.set(String(pt['@name']), new Map(kids(pt, 'operation').map((o) => [String(o['@name']), o])));

  const items: CollectionFolder[] = [];
  const variables: KeyValue[] = [];
  const baseUrls = new Map<string, string>();
  for (const service of kids(root, 'service')) {
    for (const port of kids(service, 'port')) {
      const binding = kids(root, 'binding').find((b) => b['@name'] === local(port['@binding']));
      if (!binding) continue;
      const soapBinding = kids(binding, 'binding', SOAP11)[0] ?? kids(binding, 'binding', SOAP12)[0];
      if (!soapBinding) continue; // an HTTP binding: not SOAP
      const version: 11 | 12 = kids(binding, 'binding', SOAP12)[0] ? 12 : 11;
      const address = String((kids(port, 'address', version === 12 ? SOAP12 : SOAP11)[0] ?? kids(port, 'address')[0])?.['@location'] ?? '');
      // the first address is {{baseUrl}}; other addresses get their own variable
      let urlVar = [...baseUrls.entries()].find(([, v]) => v === address)?.[0];
      if (!urlVar) {
        urlVar = baseUrls.size === 0 ? 'baseUrl' : `${slugify(String(port['@name'])).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}Url`;
        baseUrls.set(urlVar, address);
        variables.push({ key: urlVar, value: address, enabled: true });
      }
      const ops = portTypes.get(local(binding['@type'])) ?? new Map<string, X>();
      const requests: SavedHttpRequest[] = [];
      for (const bop of kids(binding, 'operation')) {
        const name = String(bop['@name']);
        const soapOp = kids(bop, 'operation', version === 12 ? SOAP12 : SOAP11)[0] ?? kids(bop, 'operation').find((o) => o !== bop);
        const action = String(soapOp?.['@soapAction'] ?? '');
        const style = String(soapOp?.['@style'] ?? soapBinding['@style'] ?? 'document');
        const op = ops.get(name);
        const parts = messages.get(local(kids(op, 'input')[0]?.['@message'])) ?? [];
        nsPrefix.clear();
        let body: string[];
        if (style === 'rpc') {
          const ns = String(kids(kids(bop, 'input')[0], 'body')[0]?.['@namespace'] ?? targetNs);
          const p = prefixFor(ns);
          body = [
            `    <${p}:${name}>`,
            ...parts.flatMap((part) => {
              const el = part['@element'] ? elements.get(local(part['@element'])) : undefined;
              if (el) return elementXml(el.node, el.schema, '      ', 0, new Set(), true);
              const ct = complexTypes.get(local(part['@type']));
              if (ct) {
                const inner = complexBody(ct.node, ct.schema, '        ', 1, new Set([local(part['@type'])]));
                return inner.length ? [`      <${part['@name']}>`, ...inner, `      </${part['@name']}>`] : [`      <${part['@name']}/>`];
              }
              return [`      <${part['@name']}>${placeholder(String(part['@type'] ?? 'string'))}</${part['@name']}>`];
            }),
            `    </${p}:${name}>`,
          ];
        } else {
          body = parts.flatMap((part) => {
            const el = part['@element'] ? elements.get(local(part['@element'])) : undefined;
            return el ? elementXml(el.node, el.schema, '    ', 0, new Set(), true) : [];
          });
        }
        const decls = [...nsPrefix.entries()].map(([ns, p]) => ` xmlns:${p}="${ns}"`).join('');
        const envelope = [`<soap:Envelope xmlns:soap="${ENVELOPE[version]}"${decls}>`, '  <soap:Header/>', '  <soap:Body>', ...body, '  </soap:Body>', '</soap:Envelope>'].join('\n');
        const headers: KeyValue[] =
          version === 12
            ? [{ key: 'Content-Type', value: `application/soap+xml; charset=utf-8${action ? `; action="${action}"` : ''}`, enabled: true }]
            : [
                { key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true },
                { key: 'SOAPAction', value: `"${action}"`, enabled: true },
              ];
        const description = docOf(op);
        requests.push({
          kind: 'http',
          id: shortId('req-'),
          name,
          ...(description ? { description } : {}),
          request: { method: 'POST', url: `{{${urlVar}}}`, params: [], headers, body: { type: 'xml', content: envelope }, auth: { type: 'inherit' } },
          assertions: [{ type: 'status', expected: 200 }],
        } as SavedHttpRequest);
      }
      if (requests.length) items.push({ kind: 'folder', id: shortId('fld-'), name: `${service['@name']} · ${port['@name']}${version === 12 ? ' (SOAP 1.2)' : ''}`, items: requests });
    }
  }
  if (!items.length) throw new ApsError('ValidationError', 'The WSDL has no SOAP operations', { suggestions: ['Only SOAP 1.1 and 1.2 bindings are imported (not HTTP GET/POST bindings).'] });
  // one port: no need for the folder level
  const name = String(root['@name'] ?? kids(root, 'service')[0]?.['@name'] ?? 'SOAP service');
  const description = docOf(root) ?? docOf(kids(root, 'service')[0]);
  return {
    collection: {
      schemaVersion: SCHEMA_VERSION,
      id: `${slugify(name) || 'wsdl'}-${shortId().slice(-4)}`,
      name,
      version: 0,
      variables,
      items: items.length === 1 ? items[0]!.items : items,
      ...(description ? { description } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
}
