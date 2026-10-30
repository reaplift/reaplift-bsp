import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

export type PageId = 'dashboard' | 'campaign' | 'admin' | 'login';

/** The address of each menu page. */
export const PAGE_PATHS: Record<PageId, string> = {
  dashboard: '/dashboard',
  campaign: '/campaign',
  admin: '/admin',
  login: '/login',
};

/** React Router v7 behaviour, switched on now; without it v6 warns on every page load. */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

type LayoutProps = {
  children: ReactNode;
  visiblePages: PageId[];
};

const navItems: Array<{ id: PageId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'campaign', label: 'Push campaign' },
  { id: 'admin', label: 'Admin' },
  { id: 'login', label: 'Login' },
];

export function Layout({ children, visiblePages }: LayoutProps) {
  const visibleNavItems = navItems.filter((item) => visiblePages.includes(item.id));

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
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.id}
              to={PAGE_PATHS[item.id]}
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
