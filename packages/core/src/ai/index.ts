import type { ModelRef, PriceEntry, ProviderConfig, TokenUsage } from '../model/types.js';
import { ApsError } from '../errors.js';
import type { ChatRequest, ChatResponse, LlmProvider } from './types.js';
import { OpenAICompatibleProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GeminiProvider } from './providers/gemini.js';
import { MockProvider } from './providers/mock.js';
import { RateLimiter, Semaphore, withRetry } from '../util/concurrency.js';
import type { Redactor } from '../util/redact.js';
import type { VariableScope } from '../vars/variables.js';

export * from './types.js';

export const DEFAULT_BASE_URLS: Record<string, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  'azure-openai': 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  ollama: 'http://127.0.0.1:11434/v1',
  mock: 'mock://local',
};

/** Wraps a provider with rate limiting, bounded concurrency and retry with exponential backoff. */
class ManagedProvider implements LlmProvider {
  private limiter: RateLimiter;
  private sem: Semaphore;

  constructor(
    private inner: LlmProvider,
    private retries = 2,
  ) {
    const rl = inner.config.rateLimit ?? {};
    this.limiter = new RateLimiter(rl);
    this.sem = new Semaphore(rl.concurrency ?? 64);
  }

  get config(): ProviderConfig {
    return this.inner.config;
  }

  chat(req: ChatRequest): Promise<ChatResponse> {
    return this.sem.run(
      () =>
        withRetry(
          async () => {
            await this.limiter.acquire(req.signal);
            const r = await this.inner.chat(req);
            this.limiter.consumeTokens(r.usage.totalTokens);
            return r;
          },
          {
            retries: this.retries,
            signal: req.signal,
            // never retry once streaming has produced output, or on client errors
            shouldRetry: (e) => ['RateLimitError', 'ServerError', 'NetworkError', 'TimeoutError'].includes((e as ApsError).kind),
          },
        ),
      req.signal,
    );
  }

  get embed(): LlmProvider['embed'] {
    return this.inner.embed ? (texts, model, signal) => this.inner.embed!(texts, model, signal) : undefined;
  }

  get listModels(): LlmProvider['listModels'] {
    return this.inner.listModels ? (signal) => this.inner.listModels!(signal) : undefined;
  }
}

export function createProvider(config: ProviderConfig, apiKey: string | undefined, redactor?: Redactor): LlmProvider {
  redactor?.addSecret(apiKey);
  let p: LlmProvider;
  switch (config.kind) {
    case 'openai-compatible':
    case 'azure-openai':
    case 'ollama':
      p = new OpenAICompatibleProvider({ ...config, baseUrl: config.baseUrl || DEFAULT_BASE_URLS[config.kind]! }, apiKey, redactor);
      break;
    case 'anthropic':
      p = new AnthropicProvider({ ...config, baseUrl: config.baseUrl || DEFAULT_BASE_URLS.anthropic! }, apiKey, redactor);
      break;
    case 'gemini':
      p = new GeminiProvider({ ...config, baseUrl: config.baseUrl || DEFAULT_BASE_URLS.gemini! }, apiKey, redactor);
      break;
    case 'mock':
      p = new MockProvider(config);
      break;
    default:
      throw new ApsError('ConfigurationError', `Unknown provider kind "${(config as ProviderConfig).kind}"`);
  }
  return new ManagedProvider(p);
}

/**
 * Resolves `ModelRef`s to live providers. Providers are matched by id, then name, then kind.
 * API keys are resolved from templates (`{{$secret.x}}`, `{{$env.X}}`) through the variable scope.
 */
export class ProviderRegistry {
  private cache = new Map<string, LlmProvider>();

  constructor(
    private configs: ProviderConfig[],
    private vars: VariableScope,
    private redactor?: Redactor,
  ) {}

  list(): ProviderConfig[] {
    return this.configs;
  }

  find(ref: string): ProviderConfig | undefined {
    const r = ref.toLowerCase();
    return (
      this.configs.find((c) => c.id.toLowerCase() === r) ??
      this.configs.find((c) => c.name.toLowerCase() === r) ??
      this.configs.find((c) => c.kind === r)
    );
  }

  get(ref: string): LlmProvider {
    const cfg = this.find(ref) ?? this.implicit(ref);
    if (!cfg)
      throw new ApsError('ConfigurationError', `No AI provider named "${ref}" is configured`, {
        suggestions: ['Add a provider in AI Lab → Providers (or providers.json in the workspace).', `Configured providers: ${this.configs.map((c) => c.name).join(', ') || 'none'}`],
      });
    let p = this.cache.get(cfg.id);
    if (!p) {
      const resolved = this.vars.resolveDeep(cfg);
      const key = resolved.apiKey && !/\{\{/.test(resolved.apiKey) ? resolved.apiKey : undefined;
      p = createProvider(resolved, key, this.redactor);
      this.cache.set(cfg.id, p);
    }
    return p;
  }

  /** Allow `provider: mock` / `provider: ollama` without explicit configuration. */
  private implicit(ref: string): ProviderConfig | undefined {
    if (ref === 'mock') return { id: 'mock', name: 'Mock', kind: 'mock', baseUrl: DEFAULT_BASE_URLS.mock! };
    if (ref === 'ollama') return { id: 'ollama', name: 'Ollama', kind: 'ollama', baseUrl: DEFAULT_BASE_URLS.ollama! };
    if (ref === 'openai-compatible' && process.env.OPENAI_API_KEY)
      return { id: 'openai-env', name: 'OpenAI (env)', kind: 'openai-compatible', baseUrl: process.env.OPENAI_BASE_URL || DEFAULT_BASE_URLS['openai-compatible']!, apiKey: '{{$env.OPENAI_API_KEY}}' };
    if (ref === 'anthropic' && process.env.ANTHROPIC_API_KEY)
      return { id: 'anthropic-env', name: 'Anthropic (env)', kind: 'anthropic', baseUrl: DEFAULT_BASE_URLS.anthropic!, apiKey: '{{$env.ANTHROPIC_API_KEY}}' };
    return undefined;
  }

  resolveModel(ref: ModelRef): { provider: LlmProvider; model: string } {
    const provider = this.get(ref.provider);
    const model = ref.name || provider.config.defaultModel;
    if (!model) throw new ApsError('ConfigurationError', `No model name given for provider "${provider.config.name}"`, { suggestions: ['Set `model.name` in the test or a default model on the provider.'] });
    return { provider, model };
  }
}

/* ------------------------------------------------------------------ cost */

function globMatch(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === value) return true;
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  return re.test(value);
}

/**
 * Estimated cost = input tokens × input price + output tokens × output price.
 * Prices are user configuration (versioned); nothing is hard-coded.
 */
export function estimateCost(pricing: PriceEntry[], provider: ProviderConfig | undefined, model: string, usage: TokenUsage): { cost?: number; priceVersion?: string } {
  const candidates = pricing.filter(
    (p) => (p.provider === '*' || p.provider === provider?.id || p.provider === provider?.kind || p.provider === provider?.name) && globMatch(p.model, model),
  );
  // prefer the most specific pattern (longest without wildcards)
  const p = candidates.sort((a, b) => b.model.replace(/\*/g, '').length - a.model.replace(/\*/g, '').length)[0];
  if (!p) return {};
  const cost = (usage.inputTokens * p.inputPerMillion + usage.outputTokens * p.outputPerMillion) / 1_000_000;
  return { cost: Math.round(cost * 1e6) / 1e6, priceVersion: p.version };
}

/* ------------------------------------------------------------------ prompts */

export function renderPrompt(template: string, vars: VariableScope, input?: Record<string, unknown>): string {
  const scope = vars.clone();
  if (input) for (const [k, v] of Object.entries(input)) scope.set(k, v, 'request');
  return scope.resolve(template);
}
