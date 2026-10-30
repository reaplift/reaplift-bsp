import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const HASH_BYTES = 32;
const PBKDF2_ITERATIONS = 120_000;
const SESSION_BYTES = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, HASH_BYTES, 'sha256');
  return `pbkdf2_sha256:${PBKDF2_ITERATIONS}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash.startsWith('pbkdf2_sha256:')) {
    return false;
  }

  const parts = storedHash.split(':');
  if (parts.length !== 4) {
    return false;
  }

  const [, iterationRaw, saltHex, expectedHex] = parts;
  const iterations = Number.parseInt(iterationRaw ?? '', 10);

  if (!Number.isFinite(iterations) || !saltHex || !expectedHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  const candidate = pbkdf2Sync(password, salt, iterations, expected.length, 'sha256');

  return timingSafeEqual(candidate, expected);
}

export function createSessionToken(): string {
  return randomBytes(SESSION_BYTES).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isSessionExpired(expiresAt: Date): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}
