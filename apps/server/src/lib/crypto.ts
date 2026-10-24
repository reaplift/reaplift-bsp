import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LENGTH = 16;

function normalizeKey(key: string): Buffer {
  const normalized = key.trim();
  if (normalized.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must be exactly 32 characters');
  }
  return Buffer.from(normalized, 'utf8');
}

export function encryptSecret(value: string, key: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-cbc', normalizeKey(key), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(value: string, key: string): string {
  const [ivHex, encryptedHex] = value.split(':');
  if (!ivHex || !encryptedHex) {
    throw new Error('Invalid encrypted value');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', normalizeKey(key), iv);

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Unable to decrypt value with the provided key');
  }
}
