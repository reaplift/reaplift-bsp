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

  it('uses list upload defaults when the settings are blank, as in .env.example', () => {
    const c = loadConfig(
      { ...base, UPLOAD_DIR: '', UPLOAD_SIGNING_SECRET: '', UPLOAD_MAX_BYTES: '', LIST_MAX_ROWS: '' },
      [],
    );
    expect(c.UPLOAD_DIR).toBe('var/uploads');
    expect(c.UPLOAD_SIGNING_SECRET).not.toBe('');
    expect(c.UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(c.LIST_MAX_ROWS).toBe(200_000);
  });

  it('reads list upload limits from the environment', () => {
    const c = loadConfig({ ...base, UPLOAD_MAX_BYTES: '1000', LIST_MAX_ROWS: '50' }, []);
    expect(c.UPLOAD_MAX_BYTES).toBe(1000);
    expect(c.LIST_MAX_ROWS).toBe(50);
  });

  it('rejects an unknown mode', () => {
    expect(() => loadConfig({ ...base, MODE: 'nope' }, [])).toThrow();
  });

  it('rejects a non-32-byte encryption key', () => {
    expect(() => loadConfig({ ...base, APP_ENCRYPTION_KEY: 'short' }, [])).toThrow();
  });
});
