import { sql, type Transaction } from 'kysely';
import type { Database } from '../../lib/db.js';
import {
  CATALOGUE,
  isEventName,
  type EventName,
  type Payload,
  type RecipientRule,
} from './catalogue.js';

export interface NotifyScope {
  /** The client the event concerns; required by `client_users` and `assigned_staff`. Null for platform events. */
  clientId?: string | null;
  /** The user who caused the event; required by `actor`. */
  actorId?: string | null;
  /** The user the event is about; required by `user`. */
  userId?: string | null;
  /** The address for the `address` rule (operator test only). */
  email?: string;
  /**
   * Identifies this change, so replaying it notifies nobody twice: (event, entityId, email, channel) is unique.
   * Defaults to `userId`, then `clientId`. When the same event can happen again to the same thing
   * (suspend, reactivate, suspend), pass something unique to this occurrence, such as the audit row's ID.
   */
  entityId?: string;
}

export interface Recipient {
  userId: string | null;
  email: string;
}

/** Works out who receives an event. Disabled users never do; one address appears once. */
export async function resolveRecipients(
  trx: Transaction<Database>,
  rules: readonly RecipientRule[],
  scope: NotifyScope,
): Promise<Recipient[]> {
  const found = new Map<string, Recipient>();
  const need = (value: string | null | undefined, rule: RecipientRule, field: string) => {
    if (!value) throw new Error(`recipient rule "${rule}" needs scope.${field}`);
    return value;
  };

  for (const rule of rules) {
    let rows: Array<{ id: string | null; email: string }>;
    if (rule === 'user_if_any' && !scope.userId) continue;
    if (rule === 'address') {
      rows = [{ id: null, email: need(scope.email, rule, 'email') }];
    } else {
      const query =
        rule === 'client_users'
          ? sql`select id, email from users
                where role = 'client' and status = 'active' and client_id = ${need(scope.clientId, rule, 'clientId')}`
          : rule === 'assigned_staff'
            ? sql`select u.id, u.email from users u
                  join staff_clients sc on sc.staff_user_id = u.id
                  where u.role = 'staff' and u.status = 'active' and sc.client_id = ${need(scope.clientId, rule, 'clientId')}`
            : rule === 'super_admins'
              ? sql`select id, email from users where role = 'super_admin' and status = 'active'`
              : sql`select id, email from users where status = 'active'
                    and id = ${need(rule === 'actor' ? scope.actorId : scope.userId, rule, rule === 'actor' ? 'actorId' : 'userId')}`;
      rows = (await query.execute(trx)).rows as Array<{ id: string; email: string }>;
    }
    for (const row of rows) {
      const email = row.email.trim().toLowerCase();
      if (!found.has(email)) found.set(email, { userId: row.id, email });
    }
  }
  return [...found.values()];
}

/**
 * Records an event's notifications inside the caller's transaction, so a rolled-back change notifies nobody.
 * Email rows start `pending` for the delivery loop; panel rows are `sent` at once (the panel lists them).
 * Returns the number of rows written; a replay writes none.
 */
export async function notify(
  trx: Transaction<Database>,
  event: EventName,
  scope: NotifyScope,
  payload: Payload = {},
): Promise<number> {
  if (!isEventName(event)) throw new Error(`unknown notification event "${String(event)}"`);
  const definition = CATALOGUE[event];
  const entityId = scope.entityId ?? scope.userId ?? scope.clientId;
  if (!entityId) throw new Error(`notify("${event}") needs scope.entityId, userId or clientId`);

  let written = 0;
  for (const recipient of await resolveRecipients(trx, definition.recipients, scope)) {
    for (const channel of definition.channels) {
      if (channel === 'panel' && !recipient.userId) continue; // the panel lists notifications by user
      const result = await sql`
        insert into notifications (client_id, user_id, email, event, entity_id, payload, channel, status,
                                   next_attempt_at, sent_at)
        values (${scope.clientId ?? null}, ${recipient.userId}, ${recipient.email}, ${event}, ${entityId},
                ${JSON.stringify(payload)}::jsonb, ${channel},
                ${channel === 'email' ? 'pending' : 'sent'},
                ${channel === 'email' ? sql`now()` : null}, ${channel === 'panel' ? sql`now()` : null})
        on conflict (event, entity_id, email, channel) do nothing
      `.execute(trx);
      written += Number(result.numAffectedRows ?? 0);
    }
  }
  return written;
}
