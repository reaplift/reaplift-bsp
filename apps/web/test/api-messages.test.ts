import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError, CLIENT_ERROR_CODES } from '../src/api/client';
import { ERROR_MESSAGES, errorMessage } from '../src/api/messages';

/** Every error code the server's source sends, read from apps/server/src. */
function serverErrorCodes(): string[] {
  const dir = path.resolve(__dirname, '../../server/src');
  const codes = new Set<string>();
  for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(path.join(dir, file), 'utf8');
    for (const m of source.matchAll(/sendError\(\s*reply,\s*\d+,\s*'([A-Z_]+)'/g)) codes.add(m[1]!);
    for (const m of source.matchAll(/error:\s*'([A-Z_]+)'/g)) codes.add(m[1]!);
  }
  return [...codes].sort();
}

describe('errorMessage', () => {
  it('has a message for every code the server sends', () => {
    const codes = serverErrorCodes();
    expect(codes.length).toBeGreaterThanOrEqual(7);
    expect(codes.filter((c) => !(c in ERROR_MESSAGES))).toEqual([]);
  });

  it("has a message for every code the panel makes up itself", () => {
    expect(CLIENT_ERROR_CODES.filter((c) => !(c in ERROR_MESSAGES))).toEqual([]);
  });

  it('turns a code into its message', () => {
    expect(errorMessage(new ApiError(401, 'INVALID_CREDENTIALS', 'server text'))).toBe('Wrong email or password.');
  });

  it('a locked login says who can unlock it', () => {
    expect(errorMessage(new ApiError(423, 'LOGIN_LOCKED', 'm', { error: 'LOGIN_LOCKED', message: 'm' }))).toBe(
      'This login is locked for 24 hours after 5 wrong passwords. Ask ReapLift to unlock it sooner.',
    );
  });

  it('never shows a raw code: unknown codes and non-API errors get the general message', () => {
    expect(errorMessage(new ApiError(409, 'SOMETHING_NEW', 'x'))).toBe('Something went wrong. Please try again.');
    expect(errorMessage(new TypeError('boom'))).toBe('Something went wrong. Please try again.');
    expect(errorMessage('a string')).toBe('Something went wrong. Please try again.');
  });

  it('every message is a sentence, not a code', () => {
    for (const message of Object.values(ERROR_MESSAGES)) {
      expect(message).toMatch(/^[A-Z][^_]*\.$/);
    }
  });
});
