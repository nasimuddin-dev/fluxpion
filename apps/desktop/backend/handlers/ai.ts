/** RPC handlers: AI providers, chat, the AI assistant and prompt/schema helpers. */
import {
  normalizeError,
  generatedTestScript,
  secretKeys,
  validateSchema,
  templateVariables,
  type ProviderConfig,
  type ModelRef,
  parseGeneratedRequest,
} from '@testpion/core';
import type { Backend, Handlers, AiChatParams } from '../backend.js';

export function aiHandlers(be: Backend): Handlers {
  return {
    'ai.providers': () => be.ws.getProviders().map((p) => ({ ...p, hasKey: !!be.secrets.get(secretKeys.provider(p.id)) || !!(p.apiKey && !p.apiKey.includes('$secret')) })),
    'ai.saveProviders': async ({ providers, keys }: { providers: ProviderConfig[]; keys?: Record<string, string> }) => {
      for (const [id, key] of Object.entries(keys ?? {})) if (key) await be.secrets.set(secretKeys.provider(id), key);
      const clean = providers.map((p) => ({ ...p, apiKey: p.apiKey && /\{\{/.test(p.apiKey) ? p.apiKey : keys?.[p.id] || be.secrets.get(secretKeys.provider(p.id)) ? `{{$secret.${secretKeys.provider(p.id)}}}` : undefined }));
      be.ws.saveProviders(clean);
      return clean;
    },
    'ai.models': async ({ providerId, environment }: { providerId: string; environment?: string }) => {
      const ctx = be.context({ environment });
      const p = ctx.services.providers.get(providerId);
      return (await p.listModels?.()) ?? [];
    },
    'ai.chat': (p: AiChatParams) => be.aiChat(p),
    'ai.cancel': ({ id }: { id: string }) => be.controllers.get(id)?.abort(),
    'ai.compare': async (p: AiChatParams & { models: ModelRef[] }) => {
      const results = await Promise.all(
        p.models.map(async (m, i) => {
          try {
            return await be.aiChat({ ...p, provider: m.provider, model: m.name ?? '', requestId: `${p.requestId}-${i}`, stream: false });
          } catch (e) {
            return { error: normalizeError(e), provider: m.provider, model: m.name };
          }
        }),
      );
      return results;
    },

    'assistant.ask': (p: { task: string; context: unknown; question?: string; environment?: string }) => be.assistant(p),
    /** Natural language → an HTTP request (shown to the user before anything is sent). */
    'ai.generateRequest': async ({ description, environment }: { description: string; environment?: string }) => {
      const r = await be.assistant({ task: 'generate-request', context: {}, question: description, environment });
      return { ...parseGeneratedRequest(r.text), model: `${r.provider}/${r.model}` };
    },
    /** pm tests for a response, labelled as AI-generated. */
    'ai.generateTests': async ({ request, response, environment }: { request: unknown; response: unknown; environment?: string }) => {
      const r = await be.assistant({ task: 'generate-pm-tests', context: { request, response }, environment });
      return { script: generatedTestScript(r.text, `${r.provider}/${r.model}`), model: `${r.provider}/${r.model}` };
    },

    'schema.validate': ({ schema, data }: { schema: unknown; data: unknown }) => validateSchema(schema, data),
    'prompt.variables': ({ template }: { template: string }) => templateVariables(template),
  };
}
