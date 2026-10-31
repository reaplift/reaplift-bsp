import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  APP_ENCRYPTION_KEY: '12345678901234567890123456789012',
};

describe('loadConfig', () => {
  it('defaults to api mode and dev version', () => {
    const c = loadConfig(base, []);
    expect(c.MODE).toBe('api');
    expect(c.APP_VERSION).toBe('dev');
  });

  it('lets --mode override MODE', () => {
    expect(loadConfig({ ...base, MODE: 'api' }, ['--mode=migrate']).MODE).toBe('migrate');
  });

  it('fills a dev encryption key when the env value is blank', () => {
    const c = loadConfig({ ...base, APP_ENCRYPTION_KEY: '' }, []);
    expect(c.APP_ENCRYPTION_KEY).toHaveLength(32);
  });

  it('defaults the Meta settings when blank', () => {
    const c = loadConfig({ ...base, META_GRAPH_VERSION: '', META_API_BASE_URL: '' }, []);
    expect(c.META_GRAPH_VERSION).toBe('v26.0');
    expect(c.META_API_BASE_URL).toBe('https://graph.facebook.com');
  });

  it('rejects an unknown mode', () => {
    expect(() => loadConfig({ ...base, MODE: 'nope' }, [])).toThrow();
  });

  it('rejects a non-32-byte encryption key', () => {
    expect(() => loadConfig({ ...base, APP_ENCRYPTION_KEY: 'short' }, [])).toThrow();
  });
});
