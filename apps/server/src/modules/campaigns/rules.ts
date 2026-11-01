import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import type { CampaignRow, RowCheck } from './campaign.js';

const WINDOW_HOURS = { day: 24, week: 24 * 7 } as const;

/** A rule for one client overrides the all-clients rule of the same type, even when it switches the rule off. */
async function ruleFor<T>(db: Kysely<Database>, clientId: string, type: string): Promise<T | null> {
  const row = (
    await sql<{ values: T; enabled: boolean }>`
      select values, enabled from rules
      where type = ${type} and (client_id = ${clientId} or client_id is null)
      order by client_id nulls last limit 1
    `.execute(db)
  ).rows[0];
  return row?.enabled ? row.values : null;
}

/** Messages that went out or are about to; blocked and failed ones reached nobody. */
const REACHED = sql`m.status in ('queued', 'sending', 'sent', 'delivered', 'read')`;

/** The same template to the same number within X hours. */
export const repeatWithinHours: RowCheck = async (db, campaign, at) => {
  const rule = await ruleFor<{ hours: number }>(db, campaign.client_id, 'repeat_within_hours');
  if (!rule) return [];
  const since = new Date(at.getTime() - rule.hours * 60 * 60 * 1000);
  return (
    await sql<{ row: number; reason: string }>`
      select lc.row_number as row, ${`repeat_within_${rule.hours}h`}::text as reason
      from list_contacts lc
      where lc.list_id = ${campaign.list_id} and lc.client_id = ${campaign.client_id} and lc.number is not null
        and exists (
          select 1 from messages m
          where m.client_id = lc.client_id and m.to_number = lc.number and m.template_id = ${campaign.template_id}
            and ${REACHED} and m.queued_at >= ${since}
        )
    `.execute(db)
  ).rows;
};

/** At most N marketing messages per number per day or week. Applies only to a marketing campaign. */
export const marketingCap: RowCheck = async (db, campaign: CampaignRow, at) => {
  const rule = await ruleFor<{ count: number; period: 'day' | 'week' }>(db, campaign.client_id, 'marketing_cap');
  if (!rule) return [];
  const since = new Date(at.getTime() - WINDOW_HOURS[rule.period] * 60 * 60 * 1000);
  return (
    await sql<{ row: number; reason: string }>`
      select lc.row_number as row, 'marketing_cap' as reason
      from list_contacts lc
      where lc.list_id = ${campaign.list_id} and lc.client_id = ${campaign.client_id} and lc.number is not null
        and exists (
          select 1 from templates own
          where own.id = ${campaign.template_id} and own.client_id = ${campaign.client_id} and own.category = 'MARKETING'
        )
        and (
          select count(*) from messages m
          join templates t on t.id = m.template_id and t.category = 'MARKETING'
          where m.client_id = lc.client_id and m.to_number = lc.number and ${REACHED} and m.queued_at >= ${since}
        ) >= ${rule.count}
    `.execute(db)
  ).rows;
};
