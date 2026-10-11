import { useEffect, useState } from 'react';
import type { HealthResponse } from '@reaplift/shared';

/** Placeholder page: shows that the panel can reach the API. Real screens arrive in milestone 2. */
export function App() {
  const [health, setHealth] = useState<HealthResponse | 'unreachable' | null>(null);

  useEffect(() => {
    fetch('/healthz')
      .then((r) => r.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch(() => setHealth('unreachable'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, color: '#2d1b4e' }}>
      <h1 style={{ color: '#6b2fbf' }}>ReapLift WhatsApp</h1>
      <p>Panel placeholder. Screens arrive in milestone 2.</p>
      <p>
        API:{' '}
        {health === null
          ? 'checking...'
          : health === 'unreachable'
            ? 'not reachable'
            : `${health.status} (version ${health.version}, database ${health.db})`}
      </p>
    </main>
  );
}
