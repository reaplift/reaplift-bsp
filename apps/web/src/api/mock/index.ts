import { LoginRequest } from '@reaplift/shared';
import type { ApiResponse, Transport } from '../transport';
import { MOCK_PASSWORD, mockClients, mockUsers, type MockUser } from './data';

/** Same rule as the server: 5 wrong passwords in a row lock the login (the server unlocks after 24 hours; the mock never does). */
const LOCKOUT_FAILURES = 5;

const error = (status: number, code: string, message: string): ApiResponse => ({
  status,
  body: { error: code, message },
});

/**
 * An in-browser stand-in for the server's auth routes, answering with the same statuses and
 * bodies (backend-api.md). State lives in memory, so reloading the page logs the user out; the
 * real server keeps the session in a cookie.
 */
export function createMockTransport(): Transport {
  let sessionUser: MockUser | null = null;
  const failures = new Map<string, number>();
  const locked = new Set<string>();

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

    const email = parsed.data.email.trim().toLowerCase();
    if (locked.has(email)) return error(423, 'LOGIN_LOCKED', 'This login is locked for 24 hours after too many wrong passwords');

    const user = mockUsers.find((u) => u.email === email);
    if (!user) return error(401, 'INVALID_CREDENTIALS', 'Wrong email or password');

    if (parsed.data.password !== MOCK_PASSWORD) {
      const count = (failures.get(email) ?? 0) + 1;
      if (count >= LOCKOUT_FAILURES) {
        locked.add(email);
        failures.delete(email);
      } else {
        failures.set(email, count);
      }
      return error(401, 'INVALID_CREDENTIALS', 'Wrong email or password');
    }

    failures.delete(email);
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
