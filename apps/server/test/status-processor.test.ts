import { describe, expect, it } from 'vitest';
import { applyMessageStatusUpdate, getStatusRank, isDuplicateStatusEvent } from '../src/lib/status-processor.js';

describe('status event processor', () => {
  it('keeps event processing idempotent for repeated statuses', () => {
    const seen = new Set(['m-123:delivered']);

    expect(isDuplicateStatusEvent('m-123', 'delivered', seen)).toBe(true);
    expect(isDuplicateStatusEvent('m-123', 'read', seen)).toBe(false);
  });

  it('applies read as a forward move and fills in delivered_at when missing', () => {
    const state = {
      status: 'sent',
      sent_at: new Date('2026-10-24T12:00:00.000Z'),
      delivered_at: null,
      read_at: null,
    };

    const next = applyMessageStatusUpdate(state, 'read', new Date('2026-10-24T12:00:05.000Z'));

    expect(next.status).toBe('read');
    expect(next.delivered_at?.toISOString()).toBe('2026-10-24T12:00:05.000Z');
    expect(next.read_at?.toISOString()).toBe('2026-10-24T12:00:05.000Z');
  });

  it('does not regress a message that is already delivered or read', () => {
    const state = {
      status: 'delivered',
      delivered_at: new Date('2026-10-24T12:00:10.000Z'),
      read_at: null,
    };

    const next = applyMessageStatusUpdate(state, 'sent', new Date('2026-10-24T12:00:11.000Z'));

    expect(next.status).toBe('delivered');
    expect(next.delivered_at?.toISOString()).toBe('2026-10-24T12:00:10.000Z');
  });

  it('records terminal failures only before delivery is reached', () => {
    const state = {
      status: 'sent',
      sent_at: new Date('2026-10-24T12:00:00.000Z'),
      failed_at: null,
      failure_reason: null,
      meta_error_code: null,
    };

    const next = applyMessageStatusUpdate(state, 'failed', new Date('2026-10-24T12:00:02.000Z'), {
      metaErrorCode: 131049,
      title: 'Marketing limit exceeded',
    });

    expect(next.status).toBe('failed');
    expect(next.failed_at?.toISOString()).toBe('2026-10-24T12:00:02.000Z');
    expect(next.meta_error_code).toBe(131049);
    expect(next.failure_reason).toBe('Marketing limit exceeded');
  });

  it('uses the design-defined status ordering', () => {
    expect(getStatusRank('queued')).toBe(0);
    expect(getStatusRank('sending')).toBe(1);
    expect(getStatusRank('sent')).toBe(2);
    expect(getStatusRank('delivered')).toBe(3);
    expect(getStatusRank('read')).toBe(4);
  });
});
