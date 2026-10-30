import type { MeResponse, Workspace } from '@reaplift/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { Layout, type NavItem } from './components/Layout';
import { Admin } from './pages/Admin';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { PushCampaign } from './pages/PushCampaign';
import { WorkspacePicker } from './pages/WorkspacePicker';
import { homePath, workspacePath } from './paths';
import './styles.css';

type PingState = {
  message: string;
  source: 'backend';
} | null;

// The prototype Admin page reloads whenever this object changes, so it must be one constant;
// the session cookie now travels on its own. Admin.tsx is replaced in S2's last piece.
const NO_AUTH_HEADER: Record<string, string> = {};

/** The sidebar and the prototype's backend message box around a logged-in page. */
function Shell({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  const [ping, setPing] = useState<PingState>(null);

  useEffect(() => {
    fetch('/api/ping')
      .then((res) => res.json())
      .then((data) => setPing(data as PingState))
      .catch(() => setPing({ message: 'Backend unreachable', source: 'backend' }));
  }, []);

  return (
    <Layout nav={nav}>
      <div className="panel" style={{ marginBottom: 18 }}>
        <h2>Backend message</h2>
        <p>{ping ? ping.message : 'Loading backend message...'}</p>
      </div>
      {children}
    </Layout>
  );
}

const adminNav = (me: MeResponse): NavItem[] => (me.user.role === 'super_admin' ? [{ to: '/admin', label: 'Admin' }] : []);

/** `/clients/:clientId/...`: only a client in the user's own list opens; any other goes to the picker. */
function WorkspaceRoutes({ me }: { me: MeResponse }) {
  const { clientId } = useParams();
  const workspace: Workspace | undefined = me.workspaces.find((w) => w.clientId === clientId);
  if (!workspace || workspace.status !== 'active') return <Navigate to="/workspaces" replace />;

  const nav: NavItem[] = [
    { to: workspacePath(workspace.clientId, 'dashboard'), label: 'Dashboard' },
    { to: workspacePath(workspace.clientId, 'campaign'), label: 'Push campaign' },
    ...adminNav(me),
  ];
  return (
    <Shell nav={nav}>
      <Routes>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="campaign" element={<PushCampaign />} />
        {/* A full path: inside a "*" route, a relative "dashboard" would resolve from the unknown
            page itself (React Router's v7_relativeSplatPath) and loop forever. */}
        <Route path="*" element={<Navigate to={workspacePath(workspace.clientId, 'dashboard')} replace />} />
      </Routes>
    </Shell>
  );
}

export function App() {
  const navigate = useNavigate();
  const { state, reload } = useAuth();

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

  if (state.status === 'logged-out') {
    return (
      <Routes>
        <Route path="/login" element={<Login onLoggedIn={(me) => navigate(homePath(me), { replace: true })} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const me: MeResponse = { user: state.user, workspaces: state.workspaces };
  const home = homePath(me);
  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/login" element={<Navigate to={home} replace />} />
      <Route
        path="/workspaces"
        element={
          home === '/workspaces' ? (
            <Shell nav={adminNav(me)}>
              <WorkspacePicker workspaces={me.workspaces} showAdmin={me.user.role === 'super_admin'} />
            </Shell>
          ) : (
            <Navigate to={home} replace />
          )
        }
      />
      <Route
        path="/admin"
        element={
          me.user.role === 'super_admin' ? (
            <Shell nav={adminNav(me)}>
              <Admin authHeader={NO_AUTH_HEADER} />
            </Shell>
          ) : (
            <Navigate to={home} replace />
          )
        }
      />
      <Route path="/clients/:clientId/*" element={<WorkspaceRoutes me={me} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
