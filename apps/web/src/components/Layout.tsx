import type { ReactNode } from 'react';

export type PageId = 'dashboard' | 'campaign' | 'lists' | 'admin' | 'login';

type LayoutProps = {
  children: ReactNode;
  currentPage: PageId;
  visiblePages: PageId[];
  onNavigate: (page: PageId) => void;
};

const navItems: Array<{ id: PageId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'campaign', label: 'Push campaign' },
  { id: 'lists', label: 'Audience lists' },
  { id: 'admin', label: 'Admin' },
  { id: 'login', label: 'Login' },
];

export function Layout({ children, currentPage, visiblePages, onNavigate }: LayoutProps) {
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
            <button
              key={item.id}
              type="button"
              className={currentPage === item.id ? 'nav-item active' : 'nav-item'}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
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
