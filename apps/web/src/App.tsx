import { useEffect, useState } from 'react';
import { canAccessPage, type AppPageId, type UserRole } from '@reaplift/shared';
import { Layout, type PageId } from './components/Layout';
import { Admin } from './pages/Admin';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { PushCampaign } from './pages/PushCampaign';
import './styles.css';

type PingState = {
  message: string;
  source: 'backend';
} | null;

const visiblePagesForRole = (role: UserRole | null): PageId[] => {
  const allPages: PageId[] = ['dashboard', 'campaign', 'admin', 'login'];
  return allPages.filter((page) => canAccessPage(role, page));
};

export function App() {
  const [page, setPage] = useState<PageId>('login');
  const [role, setRole] = useState<UserRole | null>(null);
  const [ping, setPing] = useState<PingState>(null);

  useEffect(() => {
    fetch('/api/ping')
      .then((res) => res.json())
      .then((data) => setPing(data as PingState))
      .catch(() => setPing({ message: 'Backend unreachable', source: 'backend' }));
  }, []);

  const handleNavigate = (nextPage: PageId) => {
    if (canAccessPage(role, nextPage)) {
      setPage(nextPage);
      return;
    }

    setPage(role ? 'dashboard' : 'login');
  };

  const handleLogin = (selectedRole: UserRole) => {
    setRole(selectedRole);
    setPage(selectedRole === 'super_admin' ? 'admin' : 'dashboard');
  };

  return (
    <Layout currentPage={page} visiblePages={visiblePagesForRole(role)} onNavigate={handleNavigate}>
      <div className="panel" style={{ marginBottom: 18 }}>
        <h2>Backend message</h2>
        <p>{ping ? ping.message : 'Loading backend message...'}</p>
      </div>
      {page === 'dashboard' && <Dashboard />}
      {page === 'campaign' && <PushCampaign />}
      {page === 'admin' && role === 'super_admin' && <Admin />}
      {page === 'login' && <Login onLogin={handleLogin} />}
    </Layout>
  );
}
