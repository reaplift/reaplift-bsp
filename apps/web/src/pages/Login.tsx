import { type FormEvent, useState } from 'react';
import type { UserRole } from '@reaplift/shared';

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

type LoginProps = {
  onLogin: (payload: { email: string; password: string; role: UserRole }) => void | Promise<void>;
};

export function Login({ onLogin }: LoginProps) {
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '').trim();
    const selectedRole = String(formData.get('role') ?? 'client_admin') as UserRole;

    await onLogin({ email, password, role: selectedRole });
  };

  return (
    <div className="auth-panel panel">
      <div className="panel-header">
        <h2>Login</h2>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          <span>Email</span>
          <input name="email" type="email" placeholder="name@company.com" defaultValue="admin@reaplift.ai" />
        </label>

        <label>
          <span>Password</span>
          <div className="password-field">
            <input
              name="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              defaultValue="password123"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              <EyeIcon crossed={showPassword} />
            </button>
          </div>
        </label>

        <label>
          <span>Role</span>
          <select name="role" defaultValue="super_admin">
            <option value="super_admin">Super admin</option>
            <option value="client_admin">Client admin</option>
            <option value="staff">Staff</option>
          </select>
        </label>

        <button type="submit" className="primary-button">
          Sign in
        </button>
      </form>
    </div>
  );
}
