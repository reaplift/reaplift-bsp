import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export const ErrorNote = ({ message }: { message: string | null }) =>
  message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null;

/** India time, as every date on the panel is. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function StatusPill({ status }: { status: string }) {
  const good = ['active', 'sent', 'approved', 'completed', 'running', 'read', 'delivered'].includes(status.toLowerCase());
  return (
    <span className={`status-pill ${good ? 'status-active' : status.toLowerCase() === 'draft' ? 'status-draft' : 'status-suspended'}`}>
      {status}
    </span>
  );
}

/** Where this page sits, so nobody has to remember how they got here. The last item is the current page. */
export const Breadcrumbs = ({ items }: { items: Array<{ label: string; to?: string }> }) => (
  <nav className="breadcrumbs" aria-label="Breadcrumb">
    {items.map((item, i) => (
      <span key={item.label}>
        {i > 0 && <span aria-hidden="true"> / </span>}
        {item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
      </span>
    ))}
  </nav>
);

/** A small "i" that explains something in words when hovered or focused. */
export const Hint = ({ text }: { text: string }) => (
  <span className="hint" tabIndex={0} role="note" aria-label={text}>
    <span aria-hidden="true">i</span>
    <span className="hint-text" aria-hidden="true">
      {text}
    </span>
  </span>
);

type PanelProps = { title: string; hint?: string; actions?: ReactNode; children: ReactNode };

export const Panel = ({ title, hint, actions, children }: PanelProps) => (
  <section className="panel">
    <div className="panel-header">
      <div className="panel-title">
        <h2>{title}</h2>
        {hint && <Hint text={hint} />}
      </div>
      {actions}
    </div>
    {children}
  </section>
);
