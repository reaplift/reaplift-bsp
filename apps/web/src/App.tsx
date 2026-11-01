import type { MeResponse, Workspace } from '@reaplift/shared';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './auth/context';
import { ComingSoon } from './components/ComingSoon';
import { Layout, type NavItem } from './components/Layout';
import { AuditPageView } from './pages/admin/AuditPage';
import { ClientDetailPage } from './pages/admin/ClientDetailPage';
import { ClientsPage } from './pages/admin/ClientsPage';
import { DeliveryLogPage } from './pages/admin/DeliveryLogPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { StaffPage } from './pages/admin/StaffPage';
import { ForcedPasswordChange, MyAccount } from './pages/Account';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { PushCampaign } from './pages/PushCampaign';
import { Wallet } from './pages/Wallet';
import { WorkspacePicker } from './pages/WorkspacePicker';
import { homePath, WORKSPACE_PAGES, workspacePath, type WorkspacePage } from './paths';
import './styles.css';

const adminNav = (me: MeResponse): NavItem[] =>
  me.user.role === 'super_admin'
    ? [
        { to: '/admin/clients', label: 'Clients' },
        { to: '/admin/staff', label: 'Staff' },
        { to: '/admin/settings', label: 'Settings' },
        { to: '/admin/audit', label: 'Audit log' },
        { to: '/admin/delivery-log', label: 'Delivery log' },
      ]
    : [];

/** Staff with several clients and the super admin can go back to the picker. */
const canSwitch = (me: MeResponse) => homePath(me) === '/workspaces';

const pageElement: Record<WorkspacePage, ReactNode> = {
  dashboard: <Dashboard />,
  campaign: <PushCampaign />,
  templates: <ComingSoon title="Templates" />,
  reports: <ComingSoon title="Reports" />,
  wallet: <Wallet />,
  settings: <ComingSoon title="Settings" />,
};

/** `/clients/:clientId/...`: only a client in the user's own list opens; any other goes to the picker. */
function WorkspaceRoutes({ me }: { me: MeResponse }) {
  const { clientId } = useParams();
  const workspace: Workspace | undefined = me.workspaces.find((w) => w.clientId === clientId);
  // The super admin still reaches a suspended client, to see its money and stop its campaigns.
  if (!workspace || (workspace.status !== 'active' && me.user.role !== 'super_admin')) {
    return <Navigate to="/workspaces" replace />;
  }

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

  if (state.status === 'password-change') return <ForcedPasswordChange />;

  if (state.status === 'logged-out') {
    return (
      <Routes>
        <Route
          path="/login"
          element={<Login onLoggedIn={(me) => navigate(me ? homePath(me) : '/', { replace: true })} />}
        />
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
        path="/account"
        element={
          <Layout nav={adminNav(me)} eyebrow="ReapLift" title="My account" canSwitch={canSwitch(me)}>
            <MyAccount />
          </Layout>
        }
      />
      <Route
        path="/admin/*"
        element={
          me.user.role === 'super_admin' ? (
            <Layout nav={adminNav(me)} eyebrow="ReapLift" title="Administration" canSwitch={canSwitch(me)}>
              <Routes>
                <Route path="clients" element={<ClientsPage />} />
                <Route path="clients/:id" element={<ClientDetailPage />} />
                <Route path="staff" element={<StaffPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="audit" element={<AuditPageView />} />
                <Route path="delivery-log" element={<DeliveryLogPage />} />
                <Route path="*" element={<Navigate to="/admin/clients" replace />} />
              </Routes>
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
