import type { AuthUser, MeResponse, Workspace } from '@reaplift/shared';
import { createContext, useContext } from 'react';
import type { Api } from '../api';

// Kept apart from AuthProvider.tsx, which then exports only a component, so Vite can hot-reload
// it during development instead of mixing an old and a new context.

export type AuthState =
  | { status: 'loading' }
  | { status: 'logged-out' }
  /** Logged in with a first password: nothing else opens until it is changed. */
  | { status: 'password-change' }
  /** /me failed for a reason other than "not logged in" (server down, bad response). */
  | { status: 'error'; message: string }
  | { status: 'logged-in'; user: AuthUser; workspaces: Workspace[] };

export type AuthContextValue = {
  state: AuthState;
  /** Logs in, then loads /me; null when a first password must be changed. Rejects with the ApiError for the login form to show. */
  login: (email: string, password: string) => Promise<MeResponse | null>;
  logout: () => Promise<void>;
  /** Asks /me again (after an error on load). */
  reload: () => void;
  /** Asks /me again with no loading screen, after something changed the user's list of clients. */
  refresh: () => Promise<void>;
  /** The server, for screens. Replaceable in tests. */
  api: Api;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
