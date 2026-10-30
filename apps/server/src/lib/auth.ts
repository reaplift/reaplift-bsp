import { createHash, randomBytes } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';

const SESSION_BYTES = 32;

// OWASP's argon2id baseline: 19 MiB memory, 2 passes, 1 lane.
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Hash computed once at startup, verified against when the email is unknown so the response takes as long. */
let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  if (!storedHash) {
    dummyHash ??= hashPassword('not-a-real-password');
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

export function createSessionToken(): string {
  return randomBytes(SESSION_BYTES).toString('hex');
}

/** Only this hash is stored, so a leaked database row cannot be used as a cookie. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
