import { useCallback, useEffect, useState } from 'react';
import type { MyNotification } from '@reaplift/shared';
import { useAuth } from '../auth/context';
import { formatDateTime } from './ui';

const REFRESH_MS = 60_000;

const BellIcon = () => (
  <svg
    className="bell-icon"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

/** The user's own panel notifications. A failure to load leaves the bell quiet; it is not worth interrupting a page. */
export function NotificationBell() {
  const { api } = useAuth();
  const [items, setItems] = useState<MyNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await api.myNotifications();
      setItems(body.items);
      setUnread(body.unreadCount);
    } catch {
      // Tried again on the next tick.
    }
  }, [api]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const markRead = async (item: MyNotification) => {
    if (item.readAt) return;
    await api.markNotificationRead(item.id);
    await load();
  };

  return (
    <div className="bell">
      <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <BellIcon />
        Notifications{unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          {items.length === 0 && <p className="form-note">Nothing yet.</p>}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.readAt ? 'bell-item' : 'bell-item unread'}
              onClick={() => void markRead(item)}
            >
              <strong>{item.subject}</strong>
              <small>{item.text}</small>
              <small>{formatDateTime(item.createdAt)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
