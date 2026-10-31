import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/crypto.js';

describe('crypto helpers', () => {
  it('encrypts and decrypts a token round trip', () => {
    const key = '12345678901234567890123456789012';
    const plain = 'meta-token-example';

    const encrypted = encryptSecret(plain, key);
    expect(encrypted).not.toBe(plain);
    expect(decryptSecret(encrypted, key)).toBe(plain);
  });

  it('throws when the wrong key is used', () => {
    const keyA = '12345678901234567890123456789012';
    const keyB = 'abcdefghijklmnopqrstuvwxzy123456';
    const encrypted = encryptSecret('meta-token-example', keyA);

    expect(() => decryptSecret(encrypted, keyB)).toThrow();
  });

  it('refuses a stored value that was changed', () => {
    const key = '12345678901234567890123456789012';
    const encrypted = encryptSecret('meta-token-example', key);
    const last = encrypted.at(-1) === '0' ? '1' : '0';

    expect(() => decryptSecret(`${encrypted.slice(0, -1)}${last}`, key)).toThrow();
  });
});
