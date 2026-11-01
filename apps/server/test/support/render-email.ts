import { CATALOGUE, type EventName, type Payload } from '../../src/modules/notifications/catalogue.js';

/** The email a stored notification turns into. */
export function renderEmail(event: EventName, payload: Payload) {
  const definition = CATALOGUE[event];
  return { subject: definition.subject(payload), text: definition.text(payload) };
}
