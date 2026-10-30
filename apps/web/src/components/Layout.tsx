import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

/** React Router v7 behaviour, switched on now; without it v6 warns on every page load. */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export type NavItem = { to: string; label: string };

type LayoutProps = {
  children: ReactNode;
  /** The menu for where the user is: a workspace's pages, Admin for a super admin. */
  nav: NavItem[];
};

export function Layout({ children, nav }: LayoutProps) {
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
            <p className="eyebrow">Operations</p>
            <h1>Control center</h1>
          </div>
          <button type="button" className="primary-button">
            + New campaign
          </button>
        </header>
        {children}
      </main>
    </div>
  );
}
