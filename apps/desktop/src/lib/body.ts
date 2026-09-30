import type { BodyConfig } from '../types';

/** What each body type of a request held (text is shared by the raw types, like Postman's "raw"). */
export interface BodyStash {
  byType: Partial<Record<BodyConfig['type'], BodyConfig>>;
  text?: string;
}

const TEXT_TYPES = new Set<BodyConfig['type']>(['json', 'xml', 'text', 'html']);

/** The body to show when switching to type `t`: what that type held before, else sensible carry-over. */
export function switchBodyType(body: BodyConfig, t: BodyConfig['type'], stash: BodyStash): BodyConfig {
  // remember what we're leaving (text is shared by the raw types, like Postman's "raw")
  stash.byType[body.type] = body;
  if ('content' in body) stash.text = body.content;
  if (t === 'none') return { type: 'none' };
  const prev = stash.byType[t];
  if (t === 'form-urlencoded' || t === 'multipart') {
    if (prev && 'fields' in prev) return prev;
    const other = stash.byType[t === 'multipart' ? 'form-urlencoded' : 'multipart'];
    return { type: t, fields: 'fields' in body ? body.fields : other && 'fields' in other ? other.fields.filter((f) => t === 'multipart' || !(f as { file?: unknown }).file) : [] };
  }
  if (t === 'binary') return prev ?? { type: 'binary', filePath: '' };
  if (TEXT_TYPES.has(t)) {
    const content = 'content' in body ? body.content : (stash.text ?? (prev && 'content' in prev ? prev.content : t === 'json' ? '{\n  \n}' : ''));
    return { type: t, content } as BodyConfig;
  }
  return prev ?? body;
}

