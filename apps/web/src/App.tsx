import { useState } from 'react';
import { Layout, type PageId } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { PushCampaign } from './pages/PushCampaign';
import './styles.css';

export function App() {
  const [page, setPage] = useState<PageId>('dashboard');

  return (
    <Layout currentPage={page} onNavigate={setPage}>
      {page === 'dashboard' && <Dashboard />}
      {page === 'campaign' && <PushCampaign />}
      {page === 'login' && <Login />}
    </Layout>
  );
}
