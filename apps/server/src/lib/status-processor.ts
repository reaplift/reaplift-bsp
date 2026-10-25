export type MessageStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'blocked';

export interface MessageUpdateState {
  status?: string | null;
  sent_at?: Date | null;
  delivered_at?: Date | null;
  read_at?: Date | null;
  failed_at?: Date | null;
  failure_reason?: string | null;
  meta_error_code?: number | null;
}

export interface MessageStatusDetails {
  metaErrorCode?: number | null;
  title?: string | null;
}

export const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export function getStatusRank(status: string | null | undefined): number {
  if (!status) {
    return Number.NEGATIVE_INFINITY;
  }

  return STATUS_RANK[status] ?? Number.NEGATIVE_INFINITY;
}

export function isDuplicateStatusEvent(
  metaMessageId: string,
  status: string,
  seen: Set<string>,
): boolean {
  return seen.has(`${metaMessageId}:${status}`);
}

export function applyMessageStatusUpdate(
  current: MessageUpdateState,
  incomingStatus: string,
  metaTimestamp: Date = new Date(),
  details: MessageStatusDetails = {},
): MessageUpdateState {
  const currentStatus = current.status ?? 'queued';
  const currentRank = getStatusRank(currentStatus);
  const incomingRank = getStatusRank(incomingStatus);
  const timestamp = metaTimestamp instanceof Date ? metaTimestamp : new Date(metaTimestamp);

  if (incomingStatus === 'failed') {
    if (currentRank >= getStatusRank('delivered')) {
      return { ...current };
    }

    return {
      ...current,
      status: 'failed',
      failed_at: current.failed_at ?? timestamp,
      failure_reason: details.title ?? current.failure_reason ?? null,
      meta_error_code: details.metaErrorCode ?? current.meta_error_code ?? null,
    };
  }

  if (incomingRank <= currentRank) {
    if (incomingStatus === 'read' && currentRank >= getStatusRank('sent') && !current.delivered_at) {
      return {
        ...current,
        delivered_at: timestamp,
        read_at: timestamp,
        status: 'read',
      };
    }

    if (incomingStatus === 'delivered' && currentRank >= getStatusRank('sent') && !current.delivered_at) {
      return {
        ...current,
        delivered_at: timestamp,
        status: 'delivered',
      };
    }

    return { ...current };
  }

  const next: MessageUpdateState = { ...current, status: incomingStatus };

  if (incomingStatus === 'sent' && !current.sent_at) {
    next.sent_at = timestamp;
  }

  if (incomingStatus === 'delivered') {
    next.delivered_at = current.delivered_at ?? timestamp;
  }

  if (incomingStatus === 'read') {
    next.delivered_at = current.delivered_at ?? timestamp;
    next.read_at = current.read_at ?? timestamp;
  }

  return next;
}
