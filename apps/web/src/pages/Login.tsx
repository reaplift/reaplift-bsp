import type { MeResponse } from '@reaplift/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api/messages';
import { useAuth } from '../auth/AuthProvider';

type LoginProps = {
  /** Called with the user and their workspaces once logged in; the caller decides where to go. */
  onLoggedIn: (me: MeResponse) => void;
};

export function Login({ onLoggedIn }: LoginProps) {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    // Not trimmed: spaces can be part of a password.
    const password = String(formData.get('password') ?? '');

    setError(null);
    setSubmitting(true);
    try {
      onLoggedIn(await login(email, password));
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-panel panel">
      <div className="panel-header">
        <h2>Login</h2>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          <span>Email</span>
          <input name="email" type="email" autoComplete="username" placeholder="name@company.com" required />
        </label>

        <label>
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
