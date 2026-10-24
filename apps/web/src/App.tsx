import { useEffect, useState } from 'react';
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

export function App() {
  const [page, setPage] = useState<PageId>('admin');
  const [ping, setPing] = useState<PingState>(null);

  useEffect(() => {
    fetch('/api/ping')
      .then((res) => res.json())
      .then((data) => setPing(data as PingState))
      .catch(() => setPing({ message: 'Backend unreachable', source: 'backend' }));
  }, []);

  return (
    <Layout currentPage={page} onNavigate={setPage}>
      <div className="panel" style={{ marginBottom: 18 }}>
        <h2>Backend message</h2>
        <p>{ping ? ping.message : 'Loading backend message...'}</p>
      </div>
      {page === 'dashboard' && <Dashboard />}
      {page === 'campaign' && <PushCampaign />}
      {page === 'admin' && <Admin />}
      {page === 'login' && <Login />}
    </Layout>
  );
}
