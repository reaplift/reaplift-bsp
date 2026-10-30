import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { canAccessPage, type UserRole } from '@reaplift/shared';
import { useAuth } from './auth/AuthProvider';
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

const visiblePagesForRole = (role: UserRole | null): PageId[] => {
  const allPages: PageId[] = ['dashboard', 'campaign', 'admin', 'login'];
  return allPages.filter((page) => canAccessPage(role, page));
};

// The prototype Admin page reloads whenever this object changes, so it must be one constant;
// the session cookie now travels on its own. Admin.tsx is replaced in S2's last piece.
const NO_AUTH_HEADER: Record<string, string> = {};

const homePath = (role: UserRole | null) =>
  !role ? PAGE_PATHS.login : role === 'super_admin' ? PAGE_PATHS.admin : PAGE_PATHS.dashboard;

export function App() {
  const navigate = useNavigate();
  const { state, reload } = useAuth();
  const [ping, setPing] = useState<PingState>(null);
  const role = state.status === 'logged-in' ? state.user.role : null;

  useEffect(() => {
    fetch('/api/ping')
      .then((res) => res.json())
      .then((data) => setPing(data as PingState))
      .catch(() => setPing({ message: 'Backend unreachable', source: 'backend' }));
  }, []);

  // Until /me answers, the panel does not know who is logged in; routing now would send a
  // logged-in user who reloads the page to /login.
  if (state.status === 'loading') {
    return <p className="auth-panel">Loading…</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="auth-panel panel">
        <p className="form-error" role="alert">
          {state.message}
        </p>
        <button type="button" className="primary-button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  /** A page the role may not open sends the user to the dashboard, or to login when logged out. */
  const guard = (page: PageId, element: ReactElement) =>
    canAccessPage(role, page) ? element : <Navigate to={role ? PAGE_PATHS.dashboard : PAGE_PATHS.login} replace />;

  return (
    <Layout visiblePages={visiblePagesForRole(role)}>
      <div className="panel" style={{ marginBottom: 18 }}>
        <h2>Backend message</h2>
        <p>{ping ? ping.message : 'Loading backend message...'}</p>
      </div>
      <Routes>
        <Route path="/" element={<Navigate to={homePath(role)} replace />} />
        <Route path={PAGE_PATHS.dashboard} element={guard('dashboard', <Dashboard />)} />
        <Route path={PAGE_PATHS.campaign} element={guard('campaign', <PushCampaign />)} />
        <Route
          path={PAGE_PATHS.admin}
          element={guard('admin', role === 'super_admin' ? <Admin authHeader={NO_AUTH_HEADER} /> : <></>)}
        />
        <Route
          path={PAGE_PATHS.login}
          element={
            role ? <Navigate to={homePath(role)} replace /> : <Login onLoggedIn={() => navigate('/', { replace: true })} />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
