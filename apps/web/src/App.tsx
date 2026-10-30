import type { MeResponse, Workspace } from '@reaplift/shared';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './auth/context';
import { ComingSoon } from './components/ComingSoon';
import { Layout, type NavItem } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { PushCampaign } from './pages/PushCampaign';
import { WorkspacePicker } from './pages/WorkspacePicker';
import { homePath, WORKSPACE_PAGES, workspacePath, type WorkspacePage } from './paths';
import './styles.css';

const adminNav = (me: MeResponse): NavItem[] => (me.user.role === 'super_admin' ? [{ to: '/admin', label: 'Admin' }] : []);

/** Staff with several clients and the super admin can go back to the picker. */
const canSwitch = (me: MeResponse) => homePath(me) === '/workspaces';

const pageElement: Record<WorkspacePage, ReactNode> = {
  dashboard: <Dashboard />,
  campaign: <PushCampaign />,
  templates: <ComingSoon title="Templates" />,
  reports: <ComingSoon title="Reports" />,
  wallet: <ComingSoon title="Wallet" />,
  settings: <ComingSoon title="Settings" />,
};

/** `/clients/:clientId/...`: only a client in the user's own list opens; any other goes to the picker. */
function WorkspaceRoutes({ me }: { me: MeResponse }) {
  const { clientId } = useParams();
  const workspace: Workspace | undefined = me.workspaces.find((w) => w.clientId === clientId);
  if (!workspace || workspace.status !== 'active') return <Navigate to="/workspaces" replace />;

  const nav: NavItem[] = [
    ...WORKSPACE_PAGES.map(({ page, label }) => ({ to: workspacePath(workspace.clientId, page), label })),
    ...adminNav(me),
  ];
  return (
    <Layout nav={nav} eyebrow="Client workspace" title={workspace.name} canSwitch={canSwitch(me)}>
      <Routes>
        {WORKSPACE_PAGES.map(({ page }) => (
          <Route key={page} path={page} element={pageElement[page]} />
        ))}
        {/* A full path: inside a "*" route, a relative "dashboard" would resolve from the unknown
            page itself (React Router's v7_relativeSplatPath) and loop forever. */}
        <Route path="*" element={<Navigate to={workspacePath(workspace.clientId, 'dashboard')} replace />} />
      </Routes>
    </Layout>
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
            <Layout nav={adminNav(me)} eyebrow="ReapLift" title="Choose a client" canSwitch={false}>
              <WorkspacePicker workspaces={me.workspaces} showAdmin={me.user.role === 'super_admin'} />
            </Layout>
          ) : (
            <Navigate to={home} replace />
          )
        }
      />
      <Route
        path="/admin"
        element={
          me.user.role === 'super_admin' ? (
            <Layout nav={adminNav(me)} eyebrow="ReapLift" title="Administration" canSwitch={canSwitch(me)}>
              <ComingSoon title="Admin" />
            </Layout>
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
