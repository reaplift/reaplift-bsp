/**
 * Every event that can notify someone. Each milestone adds its own entries in its notification task
 * (M3 3.6, M5 5.6, M6 6.6, ...); M2 ships the format and the operator test event.
 */

export type Channel = 'email' | 'panel';

/**
 * Who receives an event, worked out from `users` and `staff_clients` at the moment of `notify()`.
 * - `client_users`: active `client` users of the event's client (their login emails)
 * - `assigned_staff`: active staff assigned to the event's client
 * - `super_admins`: all active super admins
 * - `actor`: the user who caused the event
 * - `user`: a named user (for example the user who was just created)
 * - `address`: one email address given by the caller; only for the operator test, never for real events
 */
export type RecipientRule =
  'client_users' | 'assigned_staff' | 'super_admins' | 'actor' | 'user' | 'address';

export type Payload = Record<string, unknown>;

export interface EventDefinition {
  subject: (payload: Payload) => string;
  text: (payload: Payload) => string;
  channels: Channel[];
  recipients: RecipientRule[];
}

/** Keeps each event's name as a key while typing its entry as a full EventDefinition. */
const defineCatalogue = <Name extends string>(entries: Record<Name, EventDefinition>) => entries;

export const CATALOGUE = defineCatalogue({
  'system.test': {
    subject: () => 'ReapLift test notification',
    text: (p) =>
      `This is a test email from ReapLift, sent with "cli notify-test" at ${String(p.requestedAt ?? 'an unknown time')}.\n\nNo action is needed.`,
    channels: ['email'],
    recipients: ['address'],
  },
});

export type EventName = keyof typeof CATALOGUE;

export function isEventName(name: string): name is EventName {
  return Object.hasOwn(CATALOGUE, name);
}
