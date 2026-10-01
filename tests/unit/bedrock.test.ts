import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bedrockCredentials, bedrockRegion, createProvider } from '../../packages/core/src/index.js';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

describe('Amazon Bedrock provider', () => {
  let server: Server;
  let base: string;
  const seen: Seen[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        if (req.url!.startsWith('/foundation-models')) return res.end(JSON.stringify({ modelSummaries: [{ modelId: 'anthropic.claude-3-haiku-20240307-v1:0' }, { modelId: 'amazon.nova-lite-v1:0' }] }));
        if (req.url!.includes('/invoke')) return res.end(JSON.stringify({ embedding: [0.1, 0.2] }));
        const j = JSON.parse(body);
        const wantsTool = !!j.toolConfig;
        res.end(
          JSON.stringify({
            output: { message: { role: 'assistant', content: wantsTool ? [{ text: 'Checking.' }, { toolUse: { toolUseId: 't1', name: 'get_weather', input: { city: 'Oslo' } } }] : [{ text: 'Hello from Bedrock' }] } },
            stopReason: wantsTool ? 'tool_use' : 'end_turn',
            usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('reads the region from the endpoint and the credentials from the key', () => {
    expect(bedrockRegion('https://bedrock-runtime.eu-west-1.amazonaws.com')).toBe('eu-west-1');
    expect(bedrockRegion('http://127.0.0.1:1')).toBeUndefined();
    expect(bedrockCredentials('AKIAABCDEFGHIJKLMNOP:secret/xyz+1')).toEqual({ accessKey: 'AKIAABCDEFGHIJKLMNOP', secretKey: 'secret/xyz+1' });
    expect(bedrockCredentials('ASIAABCDEFGHIJKLMNOP:s:tok')).toEqual({ accessKey: 'ASIAABCDEFGHIJKLMNOP', secretKey: 's', sessionToken: 'tok' });
    expect(bedrockCredentials('bedrock-api-key-abc')).toEqual({ bearer: 'bedrock-api-key-abc' });
  });

  it('calls Converse signed with SigV4, with the system prompt, parameters and usage', async () => {
    const p = createProvider({ id: 'b', name: 'Bedrock', kind: 'bedrock', baseUrl: base, region: 'us-west-2' }, 'AKIAABCDEFGHIJKLMNOP:topsecret');
    const r = await p.chat({ model: 'anthropic.claude-3-haiku-20240307-v1:0', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }], temperature: 0, maxTokens: 50 });
    expect(r.text).toBe('Hello from Bedrock');
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17 });
    const req = seen.at(-1)!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/model/anthropic.claude-3-haiku-20240307-v1%3A0/converse');
    expect(req.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAABCDEFGHIJKLMNOP\/\d{8}\/us-west-2\/bedrock\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(JSON.parse(req.body)).toEqual({ messages: [{ role: 'user', content: [{ text: 'Hi' }] }], system: [{ text: 'Be brief.' }], inferenceConfig: { temperature: 0, maxTokens: 50 } });
  });

  it('uses a Bedrock API key as a bearer token, and maps tool use both ways', async () => {
    const p = createProvider({ id: 'b', name: 'Bedrock', kind: 'bedrock', baseUrl: base, region: 'us-east-1' }, 'my-bedrock-key');
    const r = await p.chat({
      model: 'amazon.nova-lite-v1:0',
      messages: [
        { role: 'user', content: 'Weather?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 't0', name: 'get_weather', arguments: { city: 'Rome' } }] },
        { role: 'tool', content: '{"temp":21}', toolCallId: 't0', toolName: 'get_weather' },
      ],
      tools: [{ name: 'get_weather', description: 'Weather of a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } }],
    });
    expect(seen.at(-1)!.headers.authorization).toBe('Bearer my-bedrock-key');
    const sent = JSON.parse(seen.at(-1)!.body);
    expect(sent.messages).toEqual([
      { role: 'user', content: [{ text: 'Weather?' }] },
      { role: 'assistant', content: [{ toolUse: { toolUseId: 't0', name: 'get_weather', input: { city: 'Rome' } } }] },
      { role: 'user', content: [{ toolResult: { toolUseId: 't0', content: [{ json: { temp: 21 } }] } }] },
    ]);
    expect(sent.toolConfig.tools[0].toolSpec).toEqual({ name: 'get_weather', description: 'Weather of a city', inputSchema: { json: { type: 'object', properties: { city: { type: 'string' } } } } });
    expect(r.text).toBe('Checking.');
    expect(r.toolCalls).toEqual([{ id: 't1', name: 'get_weather', arguments: { city: 'Oslo' }, rawArguments: '{"city":"Oslo"}' }]);
    expect(r.finishReason).toBe('tool_use');
  });

  it('lists models and embeds', async () => {
    const p = createProvider({ id: 'b', name: 'Bedrock', kind: 'bedrock', baseUrl: base, region: 'us-east-1' }, 'k');
    expect(await p.listModels!()).toEqual(['anthropic.claude-3-haiku-20240307-v1:0', 'amazon.nova-lite-v1:0']);
    expect(seen.at(-1)!.url).toBe('/foundation-models?byOutputModality=TEXT');
    expect(await p.embed!(['a', 'b'])).toEqual([
      [0.1, 0.2],
      [0.1, 0.2],
    ]);
    expect(seen.at(-1)!.url).toBe('/model/amazon.titan-embed-text-v2%3A0/invoke');
  });

  it('needs a region and credentials', async () => {
    expect(() => createProvider({ id: 'b', name: 'Bedrock', kind: 'bedrock', baseUrl: base }, 'k')).toThrow(/region/);
    const p = createProvider({ id: 'b', name: 'Bedrock', kind: 'bedrock', baseUrl: base, region: 'us-east-1' }, undefined);
    await expect(p.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/needs AWS credentials/);
  });
});
