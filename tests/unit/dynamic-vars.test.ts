import { describe, expect, it } from 'vitest';
import { DYNAMIC_VARIABLES, VariableScope, dynamicValue } from '../../packages/core/src/index.js';

describe('dynamic variables', () => {
  it('knows the Postman names, each with a description and a fresh value', () => {
    const names = DYNAMIC_VARIABLES.map((d) => d.name);
    for (const n of ['$guid', '$timestamp', '$isoTimestamp', '$randomInt', '$randomFirstName', '$randomCity', '$randomEmail', '$randomUUID', '$randomBoolean', '$randomLoremSentence', '$randomDateFuture'])
      expect(names).toContain(n);
    for (const d of DYNAMIC_VARIABLES) {
      expect(d.description, d.name).toBeTruthy();
      expect(dynamicValue(d.name), d.name).not.toBeUndefined();
    }
  });

  it('gives values of the right shape', () => {
    expect(String(dynamicValue('$guid'))).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(dynamicValue('$randomEmail'))).toMatch(/^[a-z.]+\d+@example\.test$/);
    expect(String(dynamicValue('$randomIP'))).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(String(dynamicValue('$randomHexColor'))).toMatch(/^#[0-9a-f]{6}$/);
    expect(String(dynamicValue('$randomPhoneNumber'))).toMatch(/^555-\d{3}-\d{4}$/);
    expect(Date.parse(String(dynamicValue('$randomDateFuture')))).toBeGreaterThan(Date.now());
    expect(Date.parse(String(dynamicValue('$randomDatePast')))).toBeLessThan(Date.now());
    for (let i = 0; i < 50; i++) {
      const n = Number(dynamicValue('$randomInt(5,7)'));
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(7);
    }
    expect(dynamicValue('$notAThing')).toBeUndefined();
  });

  it('resolve in templates, so imported Postman requests send real values', () => {
    const r = new VariableScope();
    const out = r.resolve('{"name":"{{$randomFirstName}} {{$randomLastName}}","city":"{{$randomCity}}","n":{{$randomInt(1,3)}}}');
    const body = JSON.parse(out) as { name: string; city: string; n: number };
    expect(body.name).toMatch(/^\S+ \S+$/);
    expect(body.city).not.toContain('{{');
    expect([1, 2, 3]).toContain(body.n);
  });
});

describe('{{$env.NAME}} allow-list', () => {
  it('reads only the allowed OS variables in the app, every one in the CLI', () => {
    process.env.TP_TEST_ALLOWED = 'yes';
    process.env.TP_TEST_SECRET = 'no';
    const app = new VariableScope(undefined, undefined, { allowEnv: true, envAccess: ['tp_test_allowed'] });
    expect(app.resolve('{{$env.TP_TEST_ALLOWED}}/{{$env.TP_TEST_SECRET}}')).toBe('yes/{{$env.TP_TEST_SECRET}}');
    expect([...app.blockedEnv]).toEqual(['TP_TEST_SECRET']);
    const cli = new VariableScope(undefined, undefined, { allowEnv: true, envAccess: 'all' });
    expect(cli.resolve('{{$env.TP_TEST_SECRET}}')).toBe('no');
    const none = new VariableScope(undefined, undefined, { allowEnv: true, envAccess: [] });
    expect(none.resolve('{{$env.TP_TEST_SECRET}}')).toBe('{{$env.TP_TEST_SECRET}}');
  });
});
