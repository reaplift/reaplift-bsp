import { useEffect, useState } from 'react';
import { canAccessPage, type UserRole } from '@reaplift/shared';
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

type SessionState = {
  email: string;
  role: UserRole;
  token: string;
};

const visiblePagesForRole = (role: UserRole | null): PageId[] => {
  const allPages: PageId[] = ['dashboard', 'campaign', 'admin', 'login'];
  return allPages.filter((page) => canAccessPage(role, page));
};

export function App() {
  const [page, setPage] = useState<PageId>('login');
  const [role, setRole] = useState<UserRole | null>(null);
  const [ping, setPing] = useState<PingState>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    const savedSession = localStorage.getItem('reaplift-session');
    if (savedSession) {
      const parsed = JSON.parse(savedSession) as SessionState;
      setRole(parsed.role);
      setPage(parsed.role === 'super_admin' ? 'admin' : 'dashboard');
    }

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

  const handleLogin = async (payload: { email: string; password: string; role: UserRole }) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as { ok?: boolean; error?: string; user?: { email: string; role: UserRole }; token?: string };

    if (!res.ok || !data.ok || !data.user || !data.token) {
      setLoginError(data.error ?? 'invalid credentials');
      return;
    }

    const session: SessionState = {
      email: data.user.email,
      role: data.user.role,
      token: data.token,
    };

    localStorage.setItem('reaplift-session', JSON.stringify(session));
    setRole(data.user.role);
    setLoginError(null);
    setPage(data.user.role === 'super_admin' ? 'admin' : 'dashboard');
  };

  const getAuthHeader = (): Record<string, string> => {
    const saved = localStorage.getItem('reaplift-session');
    if (!saved) return {};

    try {
      const session = JSON.parse(saved) as SessionState;
      return { Authorization: `Bearer ${session.token}` };
    } catch {
      return {};
    }
  };

  return (
    <Layout currentPage={page} visiblePages={visiblePagesForRole(role)} onNavigate={handleNavigate}>
      <div className="panel" style={{ marginBottom: 18 }}>
        <h2>Backend message</h2>
        <p>{ping ? ping.message : 'Loading backend message...'}</p>
      </div>
      {loginError && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <p style={{ color: '#d9485f', margin: 0 }}>{loginError}</p>
        </div>
      )}
      {page === 'dashboard' && <Dashboard />}
      {page === 'campaign' && <PushCampaign />}
      {page === 'admin' && role === 'super_admin' && <Admin authHeader={getAuthHeader()} />}
      {page === 'login' && <Login onLogin={handleLogin} />}
    </Layout>
  );
}
