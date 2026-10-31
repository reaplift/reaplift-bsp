import { LoginLockedBody } from '@reaplift/shared';
import { ApiError } from './client';

/**
 * The one place an error code becomes words on screen; every form shows errors through
 * `errorMessage`, never the code itself. The server's codes plus the panel's own (client.ts).
 */
export const ERROR_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: 'Please check the form and try again.',
  INVALID_CREDENTIALS: 'Wrong email or password.',
  LOGIN_LOCKED: 'Too many failed logins. Please try again later.',
  UNAUTHENTICATED: 'Your session has ended. Please log in again.',
  FORBIDDEN: 'You do not have access to this.',
  NOT_FOUND: 'This page or item was not found.',
  CLIENT_SUSPENDED: 'This client is suspended. Please contact ReapLift.',
  NETWORK_ERROR: 'Cannot reach the server. Check your connection and try again.',
  BAD_RESPONSE: 'The server sent something unexpected. Please try again.',
  UNEXPECTED_ERROR: 'Something went wrong. Please try again.',
};

/**
 * The message to show for anything a call threw. A lockout names the unlock time (local clock,
 * 24-hour "hh:mm"); `timeZone` is only for tests. Unknown codes and non-API errors get the
 * general message, so a raw code never reaches the screen.
 */
export function errorMessage(err: unknown, timeZone?: string): string {
  if (!(err instanceof ApiError)) return ERROR_MESSAGES.UNEXPECTED_ERROR!;
  if (err.code === 'LOGIN_LOCKED') {
    const locked = LoginLockedBody.safeParse(err.body);
    if (locked.success) {
      const time = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone,
      }).format(new Date(locked.data.lockedUntil));
      return `Too many failed logins. Locked until ${time}.`;
    }
  }
  return ERROR_MESSAGES[err.code] ?? ERROR_MESSAGES.UNEXPECTED_ERROR!;
}
