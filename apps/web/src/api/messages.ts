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
  META_REFUSED: 'Meta refused these details. Check the IDs and token, then try again.',
  NOT_CONFIGURED: 'The server is not set up to connect numbers yet. Please contact ReapLift.',
  NOT_PAUSED: 'This number is not paused.',
  NAME_TAKEN: 'This account already has a template with this name and language.',
  NAME_LOCKED: 'Meta already has this template, so its name and language cannot change.',
  NOT_EDITABLE: 'This template cannot be edited now. Copy it into a new draft instead.',
  NOT_SUBMITTABLE: 'This template cannot be submitted now. Edit it first.',
  ALREADY_CONNECTED: 'This WhatsApp number is already connected.',
  CREDIT_NOT_SHARED: 'Share the credit line first; that also resumes this number.',
  FILE_NOT_ALLOWED: 'This file type or size is not allowed for this header.',
  CLIENT_NAME_TAKEN: 'A client already has this name.',
  EMAIL_TAKEN: 'This email already has a login.',
  STATUS_UNCHANGED: 'This client already has that status.',
  CANNOT_CHANGE_SELF: 'You cannot disable your own login.',
  NOT_STAFF: 'Only staff are assigned clients.',
  PASSWORD_CHANGE_REQUIRED: 'Choose a new password first.',
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
