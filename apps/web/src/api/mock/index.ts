import { LoginRequest } from '@reaplift/shared';
import type { ApiResponse, Transport } from '../transport';
import { MOCK_PASSWORD, mockClients, mockUsers, type MockUser } from './data';

/** Same rule as the server (M1 task 1.3): 10 failures within 15 minutes lock for 15 minutes. */
const LOCKOUT_FAILURES = 10;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

const error = (status: number, code: string, message: string): ApiResponse => ({
  status,
  body: { error: code, message },
});

/**
 * An in-browser stand-in for the server's auth routes, answering with the same statuses and
 * bodies (backend-api.md). State lives in memory, so reloading the page logs the user out; the
 * real server keeps the session in a cookie. `now` is injectable so tests can move the clock.
 */
export function createMockTransport(now: () => Date = () => new Date()): Transport {
  let sessionUser: MockUser | null = null;
  const failures = new Map<string, { count: number; firstAt: number }>();
  const lockedUntil = new Map<string, number>();

  const workspacesOf = (user: MockUser) =>
    mockClients
      .filter((c) =>
        user.role === 'super_admin'
          ? true
          : user.role === 'staff'
            ? user.staffClientIds.includes(c.clientId)
            : c.clientId === user.clientId,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  const publicUser = ({ id, name, email, role }: MockUser) => ({ id, name, email, role });

  function login(body: unknown): ApiResponse {
    const parsed = LoginRequest.safeParse(body);
    if (!parsed.success) return error(400, 'INVALID_REQUEST', 'Send email and password only');

    const at = now().getTime();
    const email = parsed.data.email.trim().toLowerCase();
    const until = lockedUntil.get(email);
    if (until !== undefined && until > at) {
      return {
        status: 423,
        body: {
          error: 'LOGIN_LOCKED',
          message: 'Too many failed logins; try again later',
          lockedUntil: new Date(until).toISOString(),
        },
      };
    }

    const user = mockUsers.find((u) => u.email === email);
    if (!user) return error(401, 'INVALID_CREDENTIALS', 'Wrong email or password');

    if (parsed.data.password !== MOCK_PASSWORD) {
      const current = failures.get(email);
      const next =
        current && current.firstAt > at - LOCKOUT_WINDOW_MS
          ? { count: current.count + 1, firstAt: current.firstAt }
          : { count: 1, firstAt: at };
      if (next.count >= LOCKOUT_FAILURES) {
        lockedUntil.set(email, at + LOCKOUT_WINDOW_MS);
        failures.delete(email);
      } else {
        failures.set(email, next);
      }
      return error(401, 'INVALID_CREDENTIALS', 'Wrong email or password');
    }

    failures.delete(email);
    lockedUntil.delete(email);
    sessionUser = user;
    return { status: 200, body: { user: publicUser(user) } };
  }

  return async ({ method, path, body }) => {
    const route = `${method} ${path}`;
    if (route === 'POST /api/auth/login') return login(body);
    if (!sessionUser) return error(401, 'UNAUTHENTICATED', 'Please log in');
    if (route === 'POST /api/auth/logout') {
      sessionUser = null;
      return { status: 204, body: null };
    }
    if (route === 'GET /api/auth/me') {
      return { status: 200, body: { user: publicUser(sessionUser), workspaces: workspacesOf(sessionUser) } };
    }
    return error(404, 'NOT_FOUND', `Mock API has no route ${route}`);
  };
}

/** The mock the panel uses when `VITE_API_MODE=mock`. */
export const mockTransport = createMockTransport();
