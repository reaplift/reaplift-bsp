import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { canAccessPage, type UserRole } from '@reaplift/shared';
import { Layout, PAGE_PATHS, type PageId } from './components/Layout';
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

const homePath = (role: UserRole | null) =>
  !role ? PAGE_PATHS.login : role === 'super_admin' ? PAGE_PATHS.admin : PAGE_PATHS.dashboard;

// Read before the first render, so a logged-in user who reloads /dashboard is not sent to /login
// while the saved session is still loading.
function savedRole(): UserRole | null {
  try {
    const saved = localStorage.getItem('reaplift-session');
    return saved ? (JSON.parse(saved) as SessionState).role : null;
  } catch {
    return null;
  }
}

export function App() {
  const navigate = useNavigate();
  const [role, setRole] = useState<UserRole | null>(savedRole);
  const [ping, setPing] = useState<PingState>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ping')
      .then((res) => res.json())
      .then((data) => setPing(data as PingState))
      .catch(() => setPing({ message: 'Backend unreachable', source: 'backend' }));
  }, []);

  /** A page the role may not open sends the user to the dashboard, or to login when logged out. */
  const guard = (page: PageId, element: ReactElement) =>
    canAccessPage(role, page) ? element : <Navigate to={role ? PAGE_PATHS.dashboard : PAGE_PATHS.login} replace />;

  const handleLogin = async (payload: { email: string; password: string; role: UserRole }) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      user?: { email: string; role: UserRole };
      token?: string;
    };

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
    navigate(homePath(data.user.role));
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
    <Layout visiblePages={visiblePagesForRole(role)}>
      <div className="panel" style={{ marginBottom: 18 }}>
        <h2>Backend message</h2>
        <p>{ping ? ping.message : 'Loading backend message...'}</p>
      </div>
      {loginError && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <p style={{ color: '#d9485f', margin: 0 }}>{loginError}</p>
        </div>
      )}
      <Routes>
        <Route path="/" element={<Navigate to={homePath(role)} replace />} />
        <Route path={PAGE_PATHS.dashboard} element={guard('dashboard', <Dashboard />)} />
        <Route path={PAGE_PATHS.campaign} element={guard('campaign', <PushCampaign />)} />
        <Route
          path={PAGE_PATHS.admin}
          element={guard('admin', role === 'super_admin' ? <Admin authHeader={getAuthHeader()} /> : <></>)}
        />
        <Route path={PAGE_PATHS.login} element={<Login onLogin={handleLogin} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
