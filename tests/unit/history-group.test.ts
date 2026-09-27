import { describe, expect, it } from 'vitest';
import { dayLabel, groupByDay } from '../../apps/desktop/src/lib/format';

const now = new Date(2026, 8, 27, 10, 0); // Sunday 27 September 2026, local time
const at = (d: number, h = 9) => new Date(2026, 8, d, h).toISOString();

describe('history grouped by day', () => {
  it('labels days like Postman', () => {
    expect(dayLabel(at(27), now)).toBe('Today');
    expect(dayLabel(at(26, 23), now)).toBe('Yesterday');
    expect(dayLabel(at(22), now)).toBe(new Date(2026, 8, 22).toLocaleDateString(undefined, { weekday: 'long' }));
    expect(dayLabel(at(10), now)).toBe(new Date(2026, 8, 10).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }));
    expect(dayLabel(new Date(2025, 11, 31).toISOString(), now)).toContain('2025');
    // clock skew: a timestamp slightly in the future is still today
    expect(dayLabel(new Date(2026, 8, 27, 11).toISOString(), now)).toBe('Today');
  });

  it('interleaves one heading per day', () => {
    const rows = groupByDay([{ t: at(27, 9) }, { t: at(27, 8) }, { t: at(26) }, { t: at(10) }], (x) => x.t, now);
    expect(rows.map((r) => ('header' in r ? `# ${r.header}` : r.item.t.slice(0, 13)))).toEqual([
      '# Today',
      at(27, 9).slice(0, 13),
      at(27, 8).slice(0, 13),
      '# Yesterday',
      at(26).slice(0, 13),
      `# ${dayLabel(at(10), now)}`,
      at(10).slice(0, 13),
    ]);
  });
});
