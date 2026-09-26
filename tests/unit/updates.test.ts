import { describe, expect, it } from 'vitest';
import { compareVersions } from '../../apps/desktop/electron/semver';

describe('update version comparison', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0);
  });
  it('orders pre-releases before the release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
  });
});
