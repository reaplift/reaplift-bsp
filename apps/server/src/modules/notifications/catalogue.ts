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
 * - `user_if_any`: the same, skipped when there is none (a template copied from Meta has no submitter)
 * - `address`: one email address given by the caller; only for the operator test, never for real events
 */
export type RecipientRule =
  'client_users' | 'assigned_staff' | 'super_admins' | 'actor' | 'user' | 'user_if_any' | 'address';

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
  'account.connected': {
    subject: (p) => `WhatsApp number ${String(p.number)} is connected`,
    text: (p) => `The WhatsApp number ${String(p.number)} is now connected to ReapLift.`,
    channels: ['email', 'panel'],
    recipients: ['client_users', 'assigned_staff', 'super_admins'],
  },
  'account.paused': {
    subject: (p) => `WhatsApp number ${String(p.number)} is paused`,
    text: (p) =>
      `Sending from ${String(p.number)} has stopped. Reason: ${String(p.reason)}.\n\nA ReapLift super admin must resume it.`,
    channels: ['email', 'panel'],
    recipients: ['client_users', 'assigned_staff', 'super_admins'],
  },
  'account.resumed': {
    subject: (p) => `WhatsApp number ${String(p.number)} is sending again`,
    text: (p) => `The WhatsApp number ${String(p.number)} has been resumed.`,
    channels: ['email', 'panel'],
    recipients: ['client_users', 'assigned_staff'],
  },
  'template.approved': {
    subject: (p) => `Template ${String(p.name)} is approved`,
    text: (p) => `Meta approved the template ${String(p.name)}. It can now be used in campaigns.`,
    channels: ['email', 'panel'],
    recipients: ['user_if_any', 'client_users', 'assigned_staff'],
  },
  'template.rejected': {
    subject: (p) => `Template ${String(p.name)} was rejected`,
    text: (p) =>
      `Meta rejected the template ${String(p.name)}. Reason: ${String(p.reason)}.\n\nEdit it in the panel and submit it again.`,
    channels: ['email', 'panel'],
    recipients: ['user_if_any', 'client_users', 'assigned_staff'],
  },
  'template.paused_or_disabled': {
    subject: (p) => `Template ${String(p.name)} is ${String(p.status).toLowerCase()}`,
    text: (p) => `Meta set the template ${String(p.name)} to ${String(p.status)}. It cannot be used in campaigns for now.`,
    channels: ['email', 'panel'],
    recipients: ['client_users', 'assigned_staff', 'super_admins'],
  },
});

export type EventName = keyof typeof CATALOGUE;

export function isEventName(name: string): name is EventName {
  return Object.hasOwn(CATALOGUE, name);
}
