import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';

export interface SendStats {
  client: string;
  messages: number;
  accepted: number;
  retried: number;
  duplicated: number;
  extra_sends: number;
  failed_but_sent: number;
  duplicate_percent: number;
}

const elements = (path: ReturnType<typeof sql>) =>
  sql`jsonb_array_elements(case when jsonb_typeof(${path}) = 'array' then ${path} else '[]'::jsonb end)`;

/**
 * Double sends per client, for messages queued since `since`. Every send carries our message ID as callback data
 * and Meta gives each accepted send its own wamid, so a message with two wamids went out twice. A wamid Meta
 * reports as failed never reached the customer and does not count. Each client's numbers come from its own messages.
 */
export async function readSendStats(db: Kysely<Database>, since: Date): Promise<SendStats[]> {
  const rows = (
    await sql<Omit<SendStats, 'duplicate_percent'>>`
      with statuses as (
        select s->>'id' as wamid, s->>'status' as status, s->>'biz_opaque_callback_data' as callback
        from meta_events e
        cross join lateral ${elements(sql`e.body->'entry'`)} entry
        cross join lateral ${elements(sql`entry->'changes'`)} change
        cross join lateral ${elements(sql`change->'value'->'statuses'`)} s
        where e.received_at >= ${since} and change->>'field' = 'messages' and s->>'id' is not null
      ),
      known as (
        select id as message_id, meta_message_id as wamid from messages
        where queued_at >= ${since} and meta_message_id is not null
        union
        select m.id, s.wamid from statuses s
        join messages m on m.id::text = s.callback
        where m.queued_at >= ${since}
      ),
      sends as (
        select message_id, count(*)::int as wamids from known k
        where not exists (select 1 from statuses f where f.wamid = k.wamid and f.status = 'failed')
        group by message_id
      )
      select c.name as client,
        count(*)::int as messages,
        count(s.message_id)::int as accepted,
        count(*) filter (where m.attempts > 1)::int as retried,
        count(*) filter (where s.wamids > 1)::int as duplicated,
        coalesce(sum(s.wamids - 1), 0)::int as extra_sends,
        count(*) filter (where m.status in ('failed', 'blocked') and s.message_id is not null)::int as failed_but_sent
      from messages m
      join clients c on c.id = m.client_id
      left join sends s on s.message_id = m.id
      where m.queued_at >= ${since}
      group by c.id, c.name
      order by c.name
    `.execute(db)
  ).rows;
  return rows.map((row) => ({
    ...row,
    duplicate_percent: row.accepted === 0 ? 0 : Math.round((row.duplicated / row.accepted) * 10000) / 100,
  }));
}
