import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api as defaultApi, ApiError, type Api } from '../api';
import { errorMessage } from '../api/messages';
import { AuthContext, type AuthState } from './context';

/**
 * Who is logged in. The session is the server's httpOnly cookie, which the panel cannot read, so
 * on load the panel asks /me: 200 is logged in, 401 is logged out. `api` is replaceable for tests.
 */
export function AuthProvider({ children, api = defaultApi }: { children: ReactNode; api?: Api }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    api.me().then(
      ({ user, workspaces }) => current && setState({ status: 'logged-in', user, workspaces }),
      (err: unknown) => {
        if (!current) return;
        if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') setState({ status: 'logged-out' });
        else if (err instanceof ApiError && err.code === 'PASSWORD_CHANGE_REQUIRED') setState({ status: 'password-change' });
        else setState({ status: 'error', message: errorMessage(err) });
      },
    );
    return () => {
      current = false;
    };
  }, [api, attempt]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.login({ email, password });
      try {
        const me = await api.me();
        setState({ status: 'logged-in', user: me.user, workspaces: me.workspaces });
        return me;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'PASSWORD_CHANGE_REQUIRED') {
          setState({ status: 'password-change' });
          return null;
        }
        throw err;
      }
    },
    [api],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (err) {
      // Already logged out on the server (expired or revoked): the panel just catches up.
      if (!(err instanceof ApiError && err.code === 'UNAUTHENTICATED')) throw err;
    }
    setState({ status: 'logged-out' });
  }, [api]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = useCallback(async () => {
    const me = await api.me();
    setState({ status: 'logged-in', user: me.user, workspaces: me.workspaces });
  }, [api]);

  const value = useMemo(
    () => ({ state, login, logout, reload, refresh, api }),
    [state, login, logout, reload, refresh, api],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
