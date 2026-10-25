import type { FormEvent } from 'react';
import type { UserRole } from '@reaplift/shared';

type LoginProps = {
  onLogin: (role: UserRole) => void;
};

export function Login({ onLogin }: LoginProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const selectedRole = String(formData.get('role') ?? 'client_admin') as UserRole;
    onLogin(selectedRole);
  };

  return (
    <div className="auth-panel panel">
      <div className="panel-header">
        <h2>Login</h2>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          <span>Email</span>
          <input type="email" placeholder="name@company.com" defaultValue="admin@reaplift.ai" />
        </label>

        <label>
          <span>Password</span>
          <input type="password" placeholder="••••••••" defaultValue="password123" />
        </label>

        <label>
          <span>Role</span>
          <select name="role" defaultValue="client_admin">
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
