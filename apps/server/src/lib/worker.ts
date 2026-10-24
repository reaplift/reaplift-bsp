export interface ClaimQueuedMessagesInput {
  limit?: number;
  now?: Date;
}

/**
 * Matches the milestone 1 queue-claim contract in the low-level design:
 * rows in queued state are claimed in a short transaction and marked sending.
 */
export function claimQueuedMessages({ limit = 50, now = new Date() }: ClaimQueuedMessagesInput = {}) {
  const timestamp = now.toISOString();

  return `
    update messages
    set status = 'sending', locked_at = '${timestamp}', attempts = attempts + 1
    where id in (
      select id
      from messages
      where status = 'queued' and next_attempt_at <= '${timestamp}'
      order by id
      limit ${limit}
      for update skip locked
    )
    returning *;
  `;
}

/**
 * Meta retry policy from the design: 30s, 1m, 2m, 4m, 8m ...
 */
export function calculateNextAttemptAt(attemptNumber: number, baseTime: Date = new Date()): Date {
  if (attemptNumber < 1) {
    return new Date(baseTime.getTime());
  }

  const delayMs = 30_000 * 2 ** (attemptNumber - 1);
  return new Date(baseTime.getTime() + delayMs);
}
