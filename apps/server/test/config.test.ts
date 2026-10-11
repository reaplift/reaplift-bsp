import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('defaults to api mode and dev version', () => {
    const c = loadConfig(base, []);
    expect(c.MODE).toBe('api');
    expect(c.APP_VERSION).toBe('dev');
  });

  it('lets --mode override MODE', () => {
    expect(loadConfig({ ...base, MODE: 'api' }, ['--mode=migrate']).MODE).toBe('migrate');
  });

  it('rejects an unknown mode', () => {
    expect(() => loadConfig({ ...base, MODE: 'nope' }, [])).toThrow();
  });
});
