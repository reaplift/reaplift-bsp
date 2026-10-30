import { sql, type Kysely } from 'kysely';
import type { UserRole } from '@reaplift/shared';
import type { Database } from '../../lib/db.js';
import { createSessionToken, hashToken } from '../../lib/auth.js';

export const SESSION_COOKIE = 'rl_session';
/** A session ends 12 hours after the last request... */
export const IDLE_MS = 12 * 60 * 60 * 1000;
/** ...and never lasts more than 7 days in total. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most once a minute, not on every request. */
const TOUCH_EVERY_MS = 60 * 1000;

export interface SessionUser {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  /** The user's own client, for `client` users only. */
  clientId: string | null;
}

function expiryFrom(createdAt: Date, now: Date): Date {
  return new Date(Math.min(now.getTime() + IDLE_MS, createdAt.getTime() + MAX_AGE_MS));
}

export async function createSession(
  db: Kysely<Database>,
  user: { id: string; clientId: string | null },
  now: Date,
  meta: { userAgent?: string; ip?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = createSessionToken();
  const expiresAt = expiryFrom(now, now);
  await sql`
    insert into auth_sessions (user_id, client_id, token_hash, created_at, last_seen_at, expires_at, user_agent, ip_address)
    values (${user.id}, ${user.clientId}, ${hashToken(token)}, ${now}, ${now}, ${expiresAt},
            ${meta.userAgent ?? null}, ${meta.ip ?? null})
  `.execute(db);
  return { token, expiresAt };
}

/** Returns the session's user when the token is live and the user is active, and slides the idle expiry. */
export async function findSession(
  db: Kysely<Database>,
  token: string,
  now: Date,
): Promise<SessionUser | null> {
  const result = await sql<{
    session_id: string;
    created_at: Date;
    last_seen_at: Date;
    user_id: string;
    name: string;
    email: string;
    role: UserRole;
    client_id: string | null;
  }>`
    select s.id as session_id, s.created_at, s.last_seen_at,
           u.id as user_id, u.name, u.email, u.role, u.client_id
    from auth_sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)}
      and s.revoked_at is null
      and s.expires_at > ${now}
      and u.status = 'active'
  `.execute(db);
  const row = result.rows[0];
  if (!row) return null;

  if (now.getTime() - row.last_seen_at.getTime() >= TOUCH_EVERY_MS) {
    await sql`
      update auth_sessions set last_seen_at = ${now}, expires_at = ${expiryFrom(row.created_at, now)}
      where id = ${row.session_id}
    `.execute(db);
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    clientId: row.client_id,
  };
}

export async function revokeSession(
  db: Kysely<Database>,
  sessionId: string,
  now: Date,
): Promise<void> {
  await sql`update auth_sessions set revoked_at = ${now} where id = ${sessionId} and revoked_at is null`.execute(
    db,
  );
}
