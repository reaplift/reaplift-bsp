import type { FormEvent } from 'react';
import type { UserRole } from '@reaplift/shared';

type LoginProps = {
  onLogin: (payload: { email: string; password: string; role: UserRole }) => void | Promise<void>;
};

export function Login({ onLogin }: LoginProps) {
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '').trim();
    const selectedRole = String(formData.get('role') ?? 'client') as UserRole;

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
          <input name="password" type="password" placeholder="••••••••" defaultValue="password123" />
        </label>

        <label>
          <span>Role</span>
          <select name="role" defaultValue="super_admin">
            <option value="super_admin">Super admin</option>
            <option value="client">Client</option>
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
