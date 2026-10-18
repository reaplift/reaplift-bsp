import type { ReactNode } from 'react';

export type PageId = 'dashboard' | 'campaign' | 'login';

type LayoutProps = {
  children: ReactNode;
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
};

const navItems: Array<{ id: PageId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'campaign', label: 'Push campaign' },
  { id: 'login', label: 'Login' },
];

export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
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
          {navItems.map((item) => (
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
