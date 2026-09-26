import type { ErrorKind, NormalizedError } from './model/types.js';

/** Error type used throughout the engine. Carries a normalised, user-facing explanation. */
export class ApsError extends Error {
  readonly kind: ErrorKind;
  readonly why: string;
  readonly suggestions: string[];
  readonly details?: Record<string, unknown>;

  constructor(
    kind: ErrorKind,
    message: string,
    opts: { why?: string; suggestions?: string[]; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = kind;
    this.kind = kind;
    this.why = opts.why ?? defaultWhy[kind];
    this.suggestions = opts.suggestions ?? defaultSuggestions[kind];
    this.details = opts.details;
  }

  toJSON(): NormalizedError {
    return {
      kind: this.kind,
      message: this.message,
      what: this.message,
      why: this.why,
      suggestions: this.suggestions,
      details: this.details,
    };
  }
}

const defaultWhy: Record<ErrorKind, string> = {
  NetworkError: 'The request could not reach the server.',
  TimeoutError: 'The operation did not complete within the configured timeout.',
  AuthenticationError: 'The server rejected the supplied credentials.',
  AuthorizationError: 'The credentials are valid but lack permission for this operation.',
  ValidationError: 'The request or response did not match the expected shape.',
  RateLimitError: 'The server is throttling requests.',
  ServerError: 'The server encountered an internal error.',
  ProtocolError: 'The peer sent a message that violates the protocol.',
  SchemaError: 'A schema could not be loaded or is invalid.',
  EvaluationError: 'An evaluator could not produce a result.',
  ConfigurationError: 'The configuration is incomplete or invalid.',
  CancelledError: 'The operation was cancelled.',
  ScriptError: 'A user script threw an exception.',
};

const defaultSuggestions: Record<ErrorKind, string[]> = {
  NetworkError: [
    'Check that the host and port are correct and the server is running.',
    'Check VPN, proxy and firewall settings.',
    'For local servers, try 127.0.0.1 instead of localhost (IPv4 vs IPv6).',
  ],
  TimeoutError: ['Increase the timeout in the request settings.', 'Check whether the server is overloaded.'],
  AuthenticationError: [
    'Verify the token or API key for the selected environment.',
    'Check that the Authorization header is being sent (see the request timeline).',
    'Tokens may have expired — refresh them.',
  ],
  AuthorizationError: ['Check the scopes/roles granted to the credentials.', 'Confirm you are targeting the right tenant.'],
  ValidationError: ['Inspect the response body for field-level error messages.', 'Compare the payload against the API schema.'],
  RateLimitError: [
    'Lower concurrency or configure a rate limit for this provider.',
    'Respect the Retry-After header if present.',
  ],
  ServerError: ['Check the server logs.', 'Retry — the error may be transient.'],
  ProtocolError: ['Check that client and server support compatible protocol versions.', 'Inspect the raw trace events.'],
  SchemaError: ['Re-run schema introspection.', 'Check that the schema document is valid.'],
  EvaluationError: ['Check the evaluator configuration.', 'Judge models may return malformed output — inspect the raw response.'],
  ConfigurationError: ['Review the configuration referenced in the message.'],
  CancelledError: [],
  ScriptError: ['Check the script for exceptions; scripts run in a sandbox without filesystem or process access.'],
};

/** Map an HTTP status code to a normalised error kind (or undefined for success codes). */
export function errorKindForStatus(status: number): ErrorKind | undefined {
  if (status === 401) return 'AuthenticationError';
  if (status === 403) return 'AuthorizationError';
  if (status === 408) return 'TimeoutError';
  if (status === 429) return 'RateLimitError';
  if (status === 400 || status === 422) return 'ValidationError';
  if (status >= 500) return 'ServerError';
  return undefined;
}

/** Convert any thrown value into a NormalizedError suitable for display or persistence. */
export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof ApsError) return err.toJSON();
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string; errors?: Array<{ code?: string }> } };
  const message = e?.message ?? String(err);
  // undici wraps socket errors in `cause`; dual-stack connects report an AggregateError
  const code = e?.code ?? e?.cause?.code ?? e?.cause?.errors?.find((x) => x?.code)?.code;

  const NETWORK_CODES = /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|ENETDOWN|ECONNABORTED|UND_ERR_SOCKET|UND_ERR_CLOSED)$/;
  const looksNetwork = (code && (NETWORK_CODES.test(code) || /CERT|SSL|TLS/i.test(code))) || (e?.name === 'TypeError' && /fetch failed/i.test(message));
  let kind: ErrorKind = looksNetwork ? 'NetworkError' : 'ProtocolError';
  let why: string | undefined;
  if (e?.name === 'AbortError' || code === 'ABORT_ERR') kind = 'CancelledError';
  else if (e?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'ETIMEDOUT')
    kind = 'TimeoutError';
  else if (code === 'ECONNREFUSED') {
    kind = 'NetworkError';
    why = 'The connection was refused — nothing is listening on that host/port.';
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    kind = 'NetworkError';
    why = 'The hostname could not be resolved (DNS lookup failed).';
  } else if (code === 'ECONNRESET') {
    kind = 'NetworkError';
    why = 'The server closed the connection unexpectedly.';
  } else if (code && /CERT|SSL|TLS/i.test(code)) {
    kind = 'NetworkError';
    why = `TLS handshake failed (${code}). The certificate may be self-signed or invalid.`;
  } else if (err instanceof SyntaxError) kind = 'ValidationError';
  else if (code?.startsWith('ERR_INVALID') || code === 'ENOENT' || code === 'EACCES') {
    kind = 'ConfigurationError';
    why = code === 'ENOENT' ? 'A referenced file or command does not exist.' : code === 'EACCES' ? 'Permission denied.' : 'An invalid argument or configuration value was supplied.';
  } else if (!looksNetwork) why = 'An unexpected error occurred while executing the operation.';

  const causeMsg = e?.cause?.message || (code ? code : '');
  const base = new ApsError(kind, causeMsg && !message.includes(causeMsg) ? `${message}: ${causeMsg}` : message, why ? { why } : {});
  const out = base.toJSON();
  if (code) out.details = { code };
  if (kind === 'NetworkError' && code && /CERT|SSL|TLS/i.test(code))
    out.suggestions = ['Provide the CA certificate in request settings.', 'For local development only, enable "Disable TLS verification".'];
  return out;
}

export function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; kind?: string };
  return e?.name === 'AbortError' || e?.kind === 'CancelledError';
}
