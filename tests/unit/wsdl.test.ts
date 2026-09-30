import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectFormat, importAny, runCollection, McpManager, ProviderRegistry, Redactor, VariableScope, type CollectionFolder, type ExecServices, type SavedHttpRequest, type TestResult } from '../../packages/core/src/index.js';

const wsdl = readFileSync(join(__dirname, '../../examples/servers/patients.wsdl'), 'utf8');

const RPC = `<?xml version="1.0"?>
<definitions name="Calc" targetNamespace="urn:calc" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:calc">
  <message name="AddIn"><part name="a" type="xsd:int"/><part name="b" type="xsd:int"/></message>
  <message name="AddOut"><part name="sum" type="xsd:int"/></message>
  <portType name="CalcPort"><operation name="Add"><input message="tns:AddIn"/><output message="tns:AddOut"/></operation></portType>
  <binding name="CalcBinding" type="tns:CalcPort">
    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="Add"><soap:operation soapAction="urn:calc#Add"/><input><soap:body use="encoded" namespace="urn:calc"/></input></operation>
  </binding>
  <service name="CalcService"><port name="CalcPort" binding="tns:CalcBinding"><soap:address location="https://calc.example/soap"/></port></service>
</definitions>`;

let server: Server;
let base = '';
const seen: Array<{ action?: string; type?: string; body: string }> = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ action: req.headers.soapaction as string, type: req.headers['content-type'], body });
      res.setHeader('content-type', 'text/xml; charset=utf-8');
      res.end('<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetPatientResponse xmlns="http://vet.example/patients"><patient><name>Rex</name><species>DOG</species><id>7</id></patient></GetPatientResponse></soap:Body></soap:Envelope>');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/soap/patients`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('WSDL import', () => {
  it('detects WSDL 1.1 and builds a folder per SOAP port with sample envelopes', () => {
    expect(detectFormat(wsdl)).toBe('wsdl');
    const r = importAny(wsdl);
    const c = r.collection!;
    expect(c.name).toBe('PatientService');
    expect(c.description).toBe('Look up and register patients.');
    // both ports share the address: one {{baseUrl}}
    expect(c.variables).toEqual([{ key: 'baseUrl', value: 'http://localhost:8080/soap/patients', enabled: true }]);
    expect(c.items.map((f) => f.name)).toEqual(['PatientService · PatientSoap', 'PatientService · PatientSoap12 (SOAP 1.2)']);
    const [soap11, soap12] = c.items as CollectionFolder[];
    const get = soap11!.items[0] as SavedHttpRequest;
    expect(get.name).toBe('GetPatient');
    expect(get.description).toBe('Fetch one patient by id.');
    expect(get.request).toMatchObject({ method: 'POST', url: '{{baseUrl}}' });
    expect(get.request.headers).toEqual([
      { key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true },
      { key: 'SOAPAction', value: '"http://vet.example/patients/GetPatient"', enabled: true },
    ]);
    expect((get.request.body as { content: string }).content).toBe(
      [
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://vet.example/patients">',
        '  <soap:Header/>',
        '  <soap:Body>',
        '    <tns:GetPatient>',
        '      <tns:id>0</tns:id>',
        '      <tns:includeOwner>false</tns:includeOwner>',
        '    </tns:GetPatient>',
        '  </soap:Body>',
        '</soap:Envelope>',
      ].join('\n'),
    );
    // extension (base fields first), enums, and a recursive type (Owner → Patient) that stops
    const register = (soap11!.items[1] as SavedHttpRequest).request.body as { content: string };
    expect(register.content).toContain('<tns:name>?</tns:name>\n        <tns:species>DOG</tns:species>\n        <tns:id>0</tns:id>\n        <tns:born>2024-01-01</tns:born>');
    expect(register.content).toMatch(/<tns:owner>\s+<tns:name>\?<\/tns:name>\s+<tns:pets\/>\s+<\/tns:owner>/);
    const get12 = soap12!.items[0] as SavedHttpRequest;
    expect(get12.request.headers).toEqual([{ key: 'Content-Type', value: 'application/soap+xml; charset=utf-8; action="http://vet.example/patients/GetPatient"', enabled: true }]);
    expect((get12.request.body as { content: string }).content).toContain('xmlns:soap="http://www.w3.org/2003/05/soap-envelope"');
  });

  it('RPC style: the operation wraps its parts', () => {
    const c = importAny(RPC).collection!;
    const add = c.items[0] as SavedHttpRequest;
    expect(add.name).toBe('Add');
    expect((add.request.body as { content: string }).content).toContain('<tns:Add>\n      <a>0</a>\n      <b>0</b>\n    </tns:Add>');
    expect(add.request.headers?.[1]).toEqual({ key: 'SOAPAction', value: '"urn:calc#Add"', enabled: true });
  });

  it('sends the imported SOAP request', async () => {
    const c = importAny(wsdl).collection!;
    const results: TestResult[] = [];
    const redactor = new Redactor();
    const vars = new VariableScope();
    // collection variables come from the engine context; here the environment gives baseUrl
    vars.setScope('environment', { baseUrl: base });
    const services = { vars, providers: new ProviderRegistry([], vars, redactor), mcp: new McpManager(() => undefined), mcpServers: [], redactor, pricing: [], defaultTimeoutMs: 5000 } as ExecServices;
    const first = (c.items[0] as CollectionFolder).items[0] as SavedHttpRequest;
    await runCollection({ name: 'soap', collection: { ...c, items: [first] }, services, onEvent: (e) => void (e.type === 'test-end' && results.push(e.result)) });
    expect(results[0]?.status, JSON.stringify(results[0]?.error)).toBe('passed');
    expect(seen[0]).toMatchObject({ action: '"http://vet.example/patients/GetPatient"', type: 'text/xml; charset=utf-8' });
    expect(seen[0]!.body).toContain('<tns:GetPatient>');
  });

  it('explains what is not supported', () => {
    expect(() => importAny('<?xml version="1.0"?><description xmlns="http://www.w3.org/ns/wsdl"><x/></description>')).toThrow();
    const httpOnly = RPC.replace(/<soap:binding[^>]*\/>/, '').replace(/soap:operation/g, 'http:operation');
    expect(() => importAny(httpOnly)).toThrow(/no SOAP operations/);
  });
});
