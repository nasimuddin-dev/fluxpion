/** Types, drafts and layout constants shared by the REST view. */
import { type NormalizedError } from '../../api';
import { persisted } from '../../store';
import type { CheckConfig, CheckResult, HttpRequestSpec, HttpResponseData, SavedExample } from '../../types';
import { uid } from '../../lib/format';


export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface RestTab {
  id: string;
  name: string;
  request: HttpRequestSpec;
  preRequestScript?: string;
  testScript?: string;
  assertions: CheckConfig[];
  collectionId?: string;
  requestId?: string;
  /** Markdown documentation, saved with the request. */
  description?: string;
  /** Saved responses; persisted straight to the collection, so changing them does not make the tab dirty. */
  examples?: SavedExample[];
  dirty?: boolean;
  /** Pinned tabs stay first and are not closed by "close others / all". */
  pinned?: boolean;
}

export interface SendResult {
  response?: HttpResponseData;
  error?: NormalizedError;
  checks?: CheckResult[];
  traceId?: string;
  scriptLogs?: string[];
  visualizer?: { html?: string; error?: string; vizId?: string };
  historyId?: string;
  unresolved?: string[];
  curl?: string;
  stream?: string;
}

export const blankRequest = (): RestTab => ({
  id: uid('tab-'),
  name: 'New HTTP request',
  request: { method: 'GET', url: '{{baseUrl}}/', params: [], headers: [], auth: { type: 'inherit' }, body: { type: 'none' } },
  assertions: [{ type: 'status', expected: 200 }],
});

export const drafts = persisted<{ tabs: RestTab[]; active?: string }>('rest', { tabs: [] });
