// UI-side copies of engine types (the renderer does not import Node code).
export interface KeyValue {
  key: string;
  value: string;
  enabled?: boolean;
  description?: string;
  secret?: boolean;
  kind?: 'text' | 'file';
}

export type AuthConfig =
  | { type: 'none' }
  | { type: 'inherit' }
  | { type: 'apiKey'; key: string; value: string; in: 'header' | 'query' }
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string; prefix?: string }
  | { type: 'jwt'; secret: string; algorithm?: 'HS256' | 'HS384' | 'HS512'; payload: string; expiresInSec?: number; prefix?: string }
  | {
      type: 'oauth2';
      grantType: 'client_credentials' | 'password' | 'authorization_code';
      tokenUrl: string;
      authUrl?: string;
      clientId: string;
      clientSecret?: string;
      scope?: string;
      audience?: string;
      username?: string;
      password?: string;
      usePkce?: boolean;
      redirectUri?: string;
      clientAuth?: 'body' | 'header';
    }
  | { type: 'headers'; headers: KeyValue[] }
  /** HTTP Digest (RFC 7616): the first request gets the server's challenge, the second answers it. */
  | { type: 'digest'; username: string; password: string }
  /** AWS Signature Version 4 (API Gateway, S3, Lambda URLs, any AWS API). */
  | { type: 'awsv4'; accessKey: string; secretKey: string; sessionToken?: string; region: string; service: string }
  /** OAuth 1.0a (RFC 5849), signed per request. */
  | { type: 'oauth1'; consumerKey: string; consumerSecret: string; token?: string; tokenSecret?: string; signatureMethod?: 'HMAC-SHA1' | 'HMAC-SHA256' | 'PLAINTEXT'; realm?: string; addTo?: 'header' | 'query' };

export type BodyConfig =
  | { type: 'none' }
  | { type: 'json' | 'xml' | 'text' | 'html'; content: string }
  | { type: 'form-urlencoded'; fields: KeyValue[] }
  | { type: 'multipart'; fields: KeyValue[] }
  | { type: 'binary'; filePath: string; contentType?: string };

export interface HttpSettings {
  timeoutMs?: number;
  followRedirects?: boolean;
  insecure?: boolean;
  proxy?: string;
  clientCert?: { certPath: string; keyPath: string; caPath?: string; passphrase?: string };
}

export interface HttpRequestSpec {
  method: string;
  url: string;
  params?: KeyValue[];
  pathVariables?: KeyValue[];
  description?: string;
  headers?: KeyValue[];
  cookies?: KeyValue[];
  auth?: AuthConfig;
  body?: BodyConfig;
  settings?: HttpSettings;
}

export interface CheckConfig {
  type: string;
  name?: string;
  path?: string;
  expected?: unknown;
  [k: string]: unknown;
}

export interface CheckResult {
  type: string;
  name: string;
  passed: boolean;
  source: 'deterministic' | 'heuristic' | 'semantic' | 'ai-judge';
  score?: number;
  message: string;
  expected?: unknown;
  actual?: unknown;
  explanation?: string;
  metadata?: Record<string, unknown>;
}

export interface HttpResponseData {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  cookies: Array<{ name: string; value: string; attributes: Record<string, string> }>;
  bodyPreview: string;
  truncated: boolean;
  size: number;
  contentType: string;
  payloadPath?: string;
  durationMs: number;
  timeline: Array<{ name: string; startMs: number; durationMs: number }>;
  url: string;
  json?: unknown;
  /** Server-Sent Events of a text/event-stream response. */
  events?: SseEvent[];
  eventsDropped?: number;
  /** The user stopped the stream (the response holds what arrived until then). */
  streamStopped?: boolean;
}

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
  retry?: number;
  /** Milliseconds from the start of the request. */
  atMs: number;
}

export interface SavedExample {
  id: string;
  name: string;
  status: number;
  statusText?: string;
  headers: KeyValue[];
  body: string;
  request?: { method: string; url: string; headers?: KeyValue[]; body?: string };
  createdAt?: string;
}
export interface SavedHttpRequest {
  kind: 'http';
  id: string;
  name: string;
  /** Marks a frequently used request for the REST sidebar's Favorites view. */
  favorite?: boolean;
  request: HttpRequestSpec;
  description?: string;
  preRequestScript?: string;
  testScript?: string;
  assertions?: CheckConfig[];
  examples?: SavedExample[];
}
export interface SavedGraphQLRequest {
  kind: 'graphql';
  id: string;
  name: string;
  /** Marks a frequently used request for the REST sidebar's Favorites view. */
  favorite?: boolean;
  request: { endpoint: string; query: string; variables?: string; operationName?: string; headers?: KeyValue[]; auth?: AuthConfig };
  assertions?: CheckConfig[];
}
export interface CollectionFolder {
  kind: 'folder';
  id: string;
  name: string;
  items: CollectionNode[];
  auth?: AuthConfig;
  variables?: KeyValue[];
  preRequestScript?: string;
  testScript?: string;
}
export type CollectionNode = CollectionFolder | SavedHttpRequest | SavedGraphQLRequest;
export interface Collection {
  schemaVersion: string;
  id: string;
  name: string;
  description?: string;
  version: number;
  variables: KeyValue[];
  auth?: AuthConfig;
  preRequestScript?: string;
  testScript?: string;
  items: CollectionNode[];
  updatedAt: string;
  problem?: string;
}

export interface Environment {
  id: string;
  name: string;
  variables: Array<{ key: string; value: string; secret?: boolean; enabled?: boolean }>;
  isProduction?: boolean;
  color?: string;
  order?: number;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: 'ok' | 'error' | 'unset';
  attributes: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  error?: string;
  events?: Array<{ time: number; name: string; attributes?: Record<string, unknown> }>;
}
export interface Trace {
  traceId: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: string;
  spans: Span[];
}

export interface TestResult {
  id: string;
  name: string;
  type: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  file?: string;
  startedAt: string;
  durationMs: number;
  attempts: number;
  checks: CheckResult[];
  error?: { kind: string; message: string; what: string; why: string; suggestions: string[] };
  latencyMs?: number;
  tokens?: { inputTokens: number; outputTokens: number; totalTokens: number };
  costUsd?: number;
  model?: string;
  traceId?: string;
  output?: string;
  input?: string;
  metadata?: Record<string, unknown>;
}

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface RunSummary {
  runId: string;
  name: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  latency: LatencyStats;
  tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
  costUsd: number;
  cancelled: boolean;
  environment?: string;
  scores: Record<string, { mean: number; count: number }>;
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: 'openai-compatible' | 'azure-openai' | 'anthropic' | 'gemini' | 'ollama' | 'mock';
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  embeddingModel?: string;
  apiVersion?: string;
  headers?: KeyValue[];
  rateLimit?: { requestsPerSecond?: number; requestsPerMinute?: number; tokensPerMinute?: number; concurrency?: number };
  hasKey?: boolean;
}

export type McpServerConfig = { id: string; name: string; connected?: boolean; folder?: string } & (
  | { transport: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { transport: 'streamable-http'; url: string; headers?: KeyValue[] }
  | { transport: 'sse'; url: string; headers?: KeyValue[] }
  /** An MCP mock run in-process from a definition file in the workspace (mocks/*.mcp-mock.yaml). */
  | { transport: 'mock'; mockFile: string }
);

export interface PriceEntry {
  provider: string;
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  currency?: string;
  version: string;
}

export interface AppSettings {
  schemaVersion: string;
  theme: 'system' | 'light' | 'dark';
  fontSize: number;
  reducedMotion: boolean;
  logLevel: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';
  redactFields: string[];
  pricing: PriceEntry[];
  maxPreviewBytes: number;
  defaultTimeoutMs: number;
  telemetry: false;
  loadTesting: { allowRemoteHosts: boolean; maxVirtualUsers: number };
  lastWorkspace?: string;
  assistantProvider?: string;
  assistantModel?: string;
  workspacePaths: string[];
  globalVariables: KeyValue[];
  checkForUpdates: boolean;
  proxy?: { mode: 'env' | 'custom' | 'off'; url?: string; bypass?: string; username?: string };
  tls?: { systemCa?: boolean; extraCa?: string };
}

export interface WorkspaceCurrent {
  id: string;
  name: string;
  description?: string;
  variables: KeyValue[];
  path: string;
  environments: Environment[];
  migrations: string[];
}

/** Saved items of one kind with folders (see lib.get / lib.save). */
export interface LibraryItem<T = unknown> {
  id: string;
  name: string;
  folder?: string;
  data: T;
  updatedAt?: string;
}

export interface Library<T = unknown> {
  folders: string[];
  items: Array<LibraryItem<T>>;
}
