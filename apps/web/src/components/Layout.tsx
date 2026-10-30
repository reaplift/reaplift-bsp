import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { errorMessage } from '../api/messages';
import { useAuth } from '../auth/context';

/** React Router v7 behaviour, switched on now; without it v6 warns on every page load. */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export type NavItem = { to: string; label: string };

type LayoutProps = {
  children: ReactNode;
  /** The menu for where the user is: a workspace's pages, Admin for a super admin. */
  nav: NavItem[];
  /** Small line above the title, e.g. "Client workspace". */
  eyebrow: string;
  /** The page title: the open client's name inside a workspace. */
  title: string;
  /** Shows "Switch client", for users with more than one workspace. */
  canSwitch: boolean;
};

export function Layout({ children, nav, eyebrow, title, canSwitch }: LayoutProps) {
  const { state, logout } = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const user = state.status === 'logged-in' ? state.user : null;

  const handleLogout = async () => {
    setLogoutError(null);
    try {
      await logout();
    } catch (err) {
      setLogoutError(errorMessage(err));
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">R</div>
          <div>
            <strong>ReapLift</strong>
            <small>WhatsApp BSP</small>
          </div>
        </div>

        <nav className="nav-list">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
          </div>
          <div className="topbar-actions">
            {canSwitch && (
              <Link className="link-button" to="/workspaces">
                Switch client
              </Link>
            )}
            {user && (
              <span className="topbar-user">
                {user.name}
                <small>{user.email}</small>
              </span>
            )}
            <button type="button" className="primary-button" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </header>
        {logoutError && (
          <p className="form-error" role="alert">
            {logoutError}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
