import { describe, it, expect } from 'vitest';
import { convertCollectionScripts, exportPostmanCollection, renameScriptGlobal, runScript, toPostmanScript, type Collection } from '../../packages/core/src/index.js';

const response = { status: 200, headers: [['content-type', 'application/json']] as Array<[string, string]>, body: '{"id":7}', time: 5 };

describe('tp.* and pm.* are the same script API', () => {
  it('runs scripts written with tp, pm, or both', async () => {
    const out = await runScript(
      `tp.test("tp works", () => tp.expect(tp.response.code).to.equal(200));
       pm.test("pm works", () => pm.expect(pm.response.json().id).to.equal(7));
       tp.environment.set("a", 1);
       pm.test("same object", () => pm.expect(pm.environment.get("a")).to.equal(1) && pm.expect(tp === pm).to.be.true);
       tp.variables.set("b", tp.uuid().length);`,
      { variables: {}, environment: {}, response },
    );
    expect(out.error).toBeUndefined();
    expect(out.tests.map((t) => [t.name, t.passed])).toEqual([['tp works', true], ['pm works', true], ['same object', true]]);
    expect(out.scopeSets.environment).toEqual({ a: 1 });
    expect(out.vars.b).toBe(36);
  });
});

describe('converting between tp and pm', () => {
  it('changes only code, not strings, comments, templates, regexes or properties', () => {
    const src = [
      `tp.test("tp.test in a string stays", () => {`,
      `  // tp.environment in a comment stays`,
      `  /* tp.x */ const u = \`tp.url \${tp.environment.get("h")}/tp\`;`,
      `  const re = /tp\\.x/g; const obj = { tp: 1 }; obj.tp = 2;`,
      `  tp ["variables"].get("k"); tp.expect(1).to.equal(1);`,
      `});`,
    ].join('\n');
    const r = renameScriptGlobal(src, 'tp', 'pm');
    expect(r.changed).toBe(4);
    expect(r.code).toBe(
      [
        `pm.test("tp.test in a string stays", () => {`,
        `  // tp.environment in a comment stays`,
        `  /* tp.x */ const u = \`tp.url \${pm.environment.get("h")}/tp\`;`,
        `  const re = /tp\\.x/g; const obj = { tp: 1 }; obj.tp = 2;`,
        `  pm ["variables"].get("k"); pm.expect(1).to.equal(1);`,
        `});`,
      ].join('\n'),
    );
    // and back
    expect(renameScriptGlobal(r.code, 'pm', 'tp').code).toBe(src);
  });

  it('leaves scripts that declare their own tp alone', () => {
    for (const s of ['const tp = {}; tp.x();', 'function f(a, tp) { return tp.y; }', 'list.map((tp) => tp.id)', 'items.forEach(tp => tp.go())']) {
      const r = renameScriptGlobal(s, 'tp', 'pm');
      expect(r.code).toBe(s);
      expect(r.skipped).toMatch(/declares/);
    }
    // using tp as a value is not a declaration
    expect(renameScriptGlobal('console.log(tp); tp.test("x", () => {});', 'tp', 'pm').code).toBe('console.log(tp); pm.test("x", () => {});');
    expect(toPostmanScript(undefined)).toBeUndefined();
    expect(toPostmanScript('pm.test("already pm", () => {});')).toBe('pm.test("already pm", () => {});');
  });

  it('exports tp scripts to Postman as pm scripts', () => {
    const col: Collection = {
      schemaVersion: '1.0',
      id: 'c',
      name: 'C',
      version: 1,
      variables: [],
      preRequestScript: 'tp.variables.set("t", Date.now());',
      items: [
        { kind: 'http', id: 'r', name: 'R', request: { method: 'GET', url: 'https://x.test' }, testScript: 'tp.test("ok", () => tp.response.to.have.status(200));' },
        { kind: 'folder', id: 'f', name: 'F', items: [], preRequestScript: 'console.log("tp.stays");' },
      ],
      updatedAt: '',
    } as Collection;
    const json = JSON.stringify(exportPostmanCollection(col));
    expect(json).toContain('pm.variables.set(\\"t\\"');
    expect(json).toContain('pm.test(\\"ok\\", () => pm.response.to.have.status(200));');
    expect(json).toContain('tp.stays');
    expect(json).not.toMatch(/(^|[^.\w"])tp\.(test|variables|response)/);
  });

  it('converts every script of a collection, reporting skipped ones', () => {
    const col = {
      name: 'C',
      preRequestScript: 'pm.variables.set("a", 1);',
      items: [
        { kind: 'folder', name: 'F', testScript: 'pm.test("f", () => {});', items: [{ kind: 'http', name: 'R', testScript: 'const tp = 1; pm.test("r", () => {});' }] },
        { kind: 'http', name: 'S', preRequestScript: 'console.log("no api");' },
      ],
    };
    const r = convertCollectionScripts(col, 'pm', 'tp');
    expect(r.changed).toBe(2);
    expect(r.replacements).toBe(2);
    expect(r.skipped).toEqual([{ where: 'C / F / R (post-response)', reason: 'the script declares its own "tp"' }]);
    expect(r.collection.preRequestScript).toBe('tp.variables.set("a", 1);');
    expect(r.collection.items[0]!.testScript).toBe('tp.test("f", () => {});');
    expect(col.preRequestScript).toBe('pm.variables.set("a", 1);'); // input unchanged
    expect(convertCollectionScripts(r.collection, 'tp', 'pm').collection.preRequestScript).toBe(col.preRequestScript);
  });
});
