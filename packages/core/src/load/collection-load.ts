import type { Collection, HttpRequestSpec, RunSummary } from '../model/types.js';
import type { ExecServices } from '../runner/execute.js';
import { collectionRequests, runCollection } from '../runner/collection-run.js';
import { ApsError } from '../errors.js';
import type { LoadTarget } from './load.js';

/**
 * A collection (or some folders / requests of it) as a load-test target: each virtual user sends its
 * HTTP and GraphQL requests in order, again and again, with the collection's auth inheritance.
 *
 * Scripts don't run under load (they would measure the sandbox, not the API). A `warmUp` pass runs the
 * selection once like the Collection Runner first, with scripts, so values they set (a login token, an
 * id) are in the variables the load test uses. Variables are resolved once, before the load starts.
 */
export async function collectionLoadTarget(opts: {
  collection: Collection;
  selection?: string[];
  services: ExecServices;
  warmUp?: boolean;
  signal?: AbortSignal;
}): Promise<{ target: Extract<LoadTarget, { kind: 'sequence' }>; warmUp?: RunSummary; unresolved: string[] }> {
  const { collection, services } = opts;
  const refs = collectionRequests(collection, opts.selection);
  if (!refs.length) throw new ApsError('ConfigurationError', 'Nothing to load-test: the selection has no requests');
  let warmUp: RunSummary | undefined;
  if (opts.warmUp) warmUp = await runCollection({ name: `${collection.name} (warm-up)`, collection, selection: opts.selection, services, signal: opts.signal, traceMode: 'none' });

  const vars = services.vars.clone();
  const requests = refs.map((ref) => {
    const n = ref.node;
    let spec: HttpRequestSpec;
    if (n.kind === 'graphql') {
      const g = n.request;
      const variables = typeof g.variables === 'string' ? (g.variables.trim() ? JSON.parse(vars.resolve(g.variables)) : undefined) : g.variables;
      spec = {
        method: 'POST',
        url: g.endpoint,
        headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }, ...(g.headers ?? [])],
        body: { type: 'json', content: JSON.stringify({ query: g.query, variables, operationName: g.operationName }) },
        auth: ref.auth ?? g.auth,
      };
    } else spec = { ...n.request, auth: ref.auth ?? n.request.auth };
    return { name: [...ref.path, ref.name].join(' / '), request: vars.resolveDeep(spec) };
  });
  return { target: { kind: 'sequence', name: collection.name, requests }, warmUp, unresolved: [...vars.unresolved] };
}
