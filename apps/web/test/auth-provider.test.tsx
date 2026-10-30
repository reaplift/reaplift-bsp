import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createApi, type Api } from '../src/api';
import { ApiError } from '../src/api/client';
import { createMockTransport } from '../src/api/mock';
import type { Transport } from '../src/api/transport';
import { AuthProvider } from '../src/auth/AuthProvider';
import { useAuth } from '../src/auth/context';

const PASSWORD = 'reaplift-dev-1';

/** Shows the auth state as text and offers the actions as buttons. */
function Probe({ onError }: { onError?: (err: unknown) => void }) {
  const { state, login, logout, reload } = useAuth();
  return (
    <div>
      <output data-testid="state">
        {state.status === 'logged-in'
          ? `logged-in ${state.user.email} [${state.workspaces.map((w) => w.name).join(', ')}]`
          : state.status === 'error'
            ? `error ${state.message}`
            : state.status}
      </output>
      <button onClick={() => login('meera@reaplift.com', PASSWORD).catch(onError)}>login meera</button>
      <button onClick={() => login('meera@reaplift.com', 'wrong').catch(onError)}>login wrong</button>
      <button onClick={() => logout().catch(onError)}>logout</button>
      <button onClick={reload}>reload</button>
    </div>
  );
}

const stateText = () => screen.getByTestId('state').textContent;

/** An API over one shared mock server, so a session made by one call is seen by the next. */
function mockApi(): Api {
  const mock = createMockTransport();
  return createApi(() => mock);
}

function mount(api: Api, onError?: (err: unknown) => void) {
  render(
    <AuthProvider api={api}>
      <Probe onError={onError} />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  it('starts loading, then shows logged out when /me answers 401', async () => {
    mount(mockApi());
    expect(stateText()).toBe('loading');
    await waitFor(() => expect(stateText()).toBe('logged-out'));
  });

  it('is logged in on load when the server already has a session (a reload)', async () => {
    const mock = createMockTransport();
    await createApi(() => mock).login({ email: 'ops@northwind.com', password: PASSWORD });
    mount(createApi(() => mock));
    await waitFor(() => expect(stateText()).toBe('logged-in ops@northwind.com [Northwind Labs]'));
  });

  it('logs in and loads the workspaces, then logs out', async () => {
    mount(mockApi());
    await waitFor(() => expect(stateText()).toBe('logged-out'));
    await userEvent.click(screen.getByText('login meera'));
    await waitFor(() => expect(stateText()).toBe('logged-in meera@reaplift.com [Bluebird Retail, Northwind Labs]'));
    await userEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(stateText()).toBe('logged-out'));
  });

  it('a failed login stays logged out and hands the error to the form', async () => {
    const errors: unknown[] = [];
    mount(mockApi(), (e) => errors.push(e));
    await waitFor(() => expect(stateText()).toBe('logged-out'));
    await userEvent.click(screen.getByText('login wrong'));
    await waitFor(() => expect(errors).toHaveLength(1));
    expect((errors[0] as ApiError).code).toBe('INVALID_CREDENTIALS');
    expect(stateText()).toBe('logged-out');
  });

  it('logout still ends in logged out when the server session had already expired', async () => {
    const mock = createMockTransport();
    const api = createApi(() => mock);
    await api.login({ email: 'ops@northwind.com', password: PASSWORD });
    mount(api);
    await waitFor(() => expect(stateText()).toContain('logged-in'));
    await api.logout(); // the session ends behind the panel's back
    await userEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(stateText()).toBe('logged-out'));
  });

  it('shows an error, not "logged out", when the server cannot be reached, and can try again', async () => {
    let up = false;
    const mock = createMockTransport();
    const flaky: Transport = async (req) => {
      if (!up) throw new TypeError('Failed to fetch');
      return mock(req);
    };
    mount(createApi(() => flaky));
    await waitFor(() =>
      expect(stateText()).toBe('error Cannot reach the server. Check your connection and try again.'),
    );
    up = true;
    await act(() => userEvent.click(screen.getByText('reload')));
    await waitFor(() => expect(stateText()).toBe('logged-out'));
  });

  it('refuses to be used outside the provider', () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Probe />)).toThrow('useAuth must be used inside <AuthProvider>');
    } finally {
      console.error = quiet;
    }
  });
});
