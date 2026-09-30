import { describe, expect, it } from 'vitest';
import { switchBodyType, type BodyStash } from '../../apps/desktop/src/lib/body.js';

describe('switching the body type', () => {
  it('brings back what each type held (Postman keeps each mode)', () => {
    const stash: BodyStash = { byType: {} };
    const xml = { type: 'xml' as const, content: '<soap:Envelope/>' };
    const none = switchBodyType(xml, 'none', stash);
    expect(none).toEqual({ type: 'none' });
    // back to XML: the text is still there
    expect(switchBodyType(none, 'xml', stash)).toEqual(xml);
    // the raw types share the text
    expect(switchBodyType(xml, 'json', stash)).toEqual({ type: 'json', content: '<soap:Envelope/>' });
    // a form keeps its fields when leaving and coming back
    const form = switchBodyType(xml, 'form-urlencoded', stash);
    const filled = { type: 'form-urlencoded' as const, fields: [{ key: 'a', value: '1' }] };
    expect(form).toEqual({ type: 'form-urlencoded', fields: [] });
    const bin = switchBodyType(filled, 'binary', stash);
    expect(switchBodyType(bin, 'form-urlencoded', stash)).toEqual(filled);
    expect(switchBodyType(bin, 'xml', stash)).toEqual(xml);
  });

  it('starts JSON with an empty object when there was no text', () => {
    expect(switchBodyType({ type: 'none' }, 'json', { byType: {} })).toEqual({ type: 'json', content: '{\n  \n}' });
  });
});
