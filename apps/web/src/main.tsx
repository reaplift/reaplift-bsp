import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ROUTER_FUTURE } from './components/Layout';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={ROUTER_FUTURE}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
