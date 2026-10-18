export function Login() {
  return (
    <div className="auth-panel panel">
      <div className="panel-header">
        <h2>Login</h2>
      </div>

      <form className="form-grid">
        <label>
          <span>Email</span>
          <input type="email" placeholder="name@company.com" defaultValue="admin@reaplift.ai" />
        </label>

        <label>
          <span>Password</span>
          <input type="password" placeholder="••••••••" defaultValue="password123" />
        </label>

        <button type="submit" className="primary-button">
          Sign in
        </button>
      </form>
    </div>
  );
}
