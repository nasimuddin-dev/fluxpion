import { describe, expect, it } from 'vitest';
import { runScript } from '../../packages/core/src/index.js';

const PAGE = `<!doctype html><html><head><title>Clinic &amp; Co</title></head><body>
<h1 class="title main">Patients</h1>
<ul id="list">
  <li data-id="7" class="dog"><a href="/p/7">Rex</a></li>
  <li data-id="8" class="cat"><a href="/p/8">Whiskers</a></li>
  <li data-id="9" class="dog"><a href="/p/9">Fido</a></li>
</ul>
<form><input name="q" value="rabies"></form>
</body></html>`;

const run = (code: string) =>
  runScript(code, { request: { method: 'GET', url: 'http://x', headers: [] }, response: { status: 200, headers: [['content-type', 'text/html']], body: PAGE, time: 3 }, vars: {} } as never);

describe('cheerio in scripts', () => {
  it('selects, reads text and attributes, and walks the tree', async () => {
    const out = await run(`
      const $ = cheerio.load(pm.response.text());
      pm.test('title', () => pm.expect($('title').text()).to.equal('Clinic & Co'));
      pm.test('count and attr', () => { pm.expect($('li').length).to.equal(3); pm.expect($('li').eq(1).attr('data-id')).to.equal('8'); });
      pm.test('find and chain', () => pm.expect($('#list').find('li.dog a').last().attr('href')).to.equal('/p/9'));
      pm.test('each and $(el)', () => { const names = []; $('li').each((i, el) => { names.push($(el).text().trim()); }); pm.expect(names).to.eql(['Rex', 'Whiskers', 'Fido']); });
      pm.test('map', () => pm.expect($('a').map((i, el) => $(el).attr('href')).get()).to.eql(['/p/7', '/p/8', '/p/9']));
      pm.test('classes, values, children, parent', () => {
        pm.expect($('h1').hasClass('main')).to.equal(true);
        pm.expect($('input[name=q]').val()).to.equal('rabies');
        pm.expect($('#list').children().length).to.equal(3);
        pm.expect($('a').first().parent().attr('data-id')).to.equal('7');
        pm.expect($('li').filter('.cat').text()).to.equal('Whiskers');
      });
      pm.test('require works too', () => pm.expect(require('cheerio').load('<p>x</p>')('p').text()).to.equal('x'));
    `);
    expect(out.error).toBeUndefined();
    expect(out.tests.filter((t) => !t.passed)).toEqual([]);
    expect(out.tests).toHaveLength(7);
  });

  it('reports a bad selector', async () => {
    const out = await run("cheerio.load('<p/>')('p[');");
    expect(out.error).toMatch(/cheerio/);
  });
});
