import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LENGTH = 12;

function normalizeKey(key: string): Buffer {
  const normalized = key.trim();
  if (normalized.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must be exactly 32 characters');
  }
  return Buffer.from(normalized, 'utf8');
}

/** AES-256-GCM, so a changed value fails to decrypt instead of giving a wrong token. Format: iv:tag:ciphertext, in hex. */
export function encryptSecret(value: string, key: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', normalizeKey(key), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('hex')).join(':');
}

export function decryptSecret(value: string, key: string): string {
  const [ivHex, tagHex, encryptedHex] = value.split(':');
  if (!ivHex || !tagHex || !encryptedHex) {
    throw new Error('Invalid encrypted value');
  }

  const decipher = createDecipheriv('aes-256-gcm', normalizeKey(key), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  try {
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Unable to decrypt value with the provided key');
  }
}
