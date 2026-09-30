import { describe, expect, it } from 'vitest';
import { countDatasetRecords, datasetFormatOf } from '../../packages/core/src/runner/saved-evaluations.js';

const jsonl = '{"input":"Cancel","expected":"cancellation"}\n{"input":"Refill","expected":"refill"}\n{"input":"Book","expected":"booking"}';

describe('saved evaluation datasets', () => {
  it('treats "json" whose text is one object per line as JSONL', () => {
    expect(datasetFormatOf(jsonl, 'json')).toBe('jsonl');
    expect(countDatasetRecords(jsonl, 'json')).toBe(3);
  });

  it('keeps real JSON and other formats as they are', () => {
    expect(datasetFormatOf('[{"a":1},{"a":2}]', 'json')).toBe('json');
    expect(countDatasetRecords('[{"a":1},{"a":2}]', 'json')).toBe(2);
    expect(datasetFormatOf('not json', 'json')).toBe('json');
    expect(countDatasetRecords('not json', 'json')).toBe(0);
    expect(datasetFormatOf('a,b\n1,2', 'csv')).toBe('csv');
  });
});
