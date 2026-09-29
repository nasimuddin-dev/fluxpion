import { describe, expect, it } from 'vitest';
import { compareVersions } from '../../apps/desktop/electron/semver';
import { notesToText, summariseNotes } from '../../apps/desktop/src/lib/release-notes';

describe('release notes in the update dialog', () => {
  // what electron-updater gets from GitHub's releases feed for 0.6.0 (shortened)
  const html = `<ul>
<li><strong>FluxPion is now TestPion.</strong> New name for the app, the <code>testpion</code> CLI (<code>fluxpion</code> still works), the <code>@testpion/*</code> packages and the documentation site (<a href="https://nasimuddin-dev.github.io/testpion/" rel="nofollow">https://nasimuddin-dev.github.io/testpion/</a>). Nothing to do when upgrading.</li>
<li><strong>Update checks are easier to diagnose.</strong> Every check &amp; failure is logged.</li>
<li><strong>Postman Visualizer (<code>pm.visualizer.set</code>).</strong> A test script can render HTML.</li>
</ul>`;

  it('turns the HTML from the feed into clean headlines (no tags or entities)', () => {
    expect(summariseNotes(html)).toBe('• FluxPion is now TestPion\n• Update checks are easier to diagnose\n• Postman Visualizer (pm.visualizer.set)');
    expect(notesToText(html)).toContain('Every check & failure is logged.');
    expect(notesToText(html)).not.toMatch(/[<>]/);
  });

  it('handles Markdown from the GitHub API, long lists and plain text', () => {
    expect(summariseNotes('## 0.6.0\n\n- **One.** Detail [link](https://x.test).\n- **Two `code`.** More.')).toBe('• One\n• Two code');
    const many = Array.from({ length: 9 }, (_, i) => `- **Item ${i}.** text`).join('\n');
    expect(summariseNotes(many).split('\n').at(-1)).toBe('…and 3 more changes');
    expect(summariseNotes('<p>Just a fix &lt;small&gt;.</p>')).toBe('Just a fix <small>.');
  });
});

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
