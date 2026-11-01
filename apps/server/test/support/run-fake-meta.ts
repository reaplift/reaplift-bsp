/**
 * The fake Meta server on its own, to run the M4 flow by hand with no Meta account. Point the server at it with
 * META_API_BASE_URL. After accepting a message, it posts signed sent, delivered and read webhooks to WEBHOOK_URL.
 * FAKE_META_FAIL_CODE makes every send fail with that Meta error code. FAKE_META_LATE_FIRST_MS accepts the first
 * send but answers only after that long, as when the worker times out on a message Meta did take.
 * FAKE_META_FAIL_EVERY fails every Nth send with 131026. FAKE_META_LIMIT sets the messaging limit it reports.
 *
 *   pnpm --filter @reaplift/server fake-meta
 */
import { FakeMeta, metaError, signWebhook, statusWebhook } from './fake-meta.js';

const webhookUrl = process.env.WEBHOOK_URL ?? 'http://localhost:3000/webhooks/meta';
const secret = process.env.META_APP_SECRET ?? '';
const port = Number(process.env.FAKE_META_PORT ?? 4010);
const failCode = Number(process.env.FAKE_META_FAIL_CODE ?? 0);
const lateMs = Number(process.env.FAKE_META_LATE_FIRST_MS ?? 0);

async function post(metaMessageId: string, status: string, callbackData?: string) {
  const body = statusWebhook(metaMessageId, status, Math.floor(Date.now() / 1000), {
    ...(callbackData !== undefined && { biz_opaque_callback_data: callbackData }),
    ...(status === 'read' ? {} : { pricing: { billable: true, type: 'regular', category: 'utility' } }),
  });
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signWebhook(body, secret) },
    body,
  });
  if (res.status !== 200) console.log(`webhook ${status} for ${metaMessageId}: ${res.status}`);
}

const fake = new FakeMeta({
  onAccepted(id, to, callbackData) {
    if (!process.env.FAKE_META_QUIET) console.log(`accepted a message to ${to}: ${id}`);
    ['sent', 'delivered', 'read'].forEach((status, i) => {
      setTimeout(() => void post(id, status, callbackData), (i + 1) * 1000);
    });
  },
});
fake.failEvery = Number(process.env.FAKE_META_FAIL_EVERY ?? 0);
fake.messagingLimit = process.env.FAKE_META_LIMIT ?? fake.messagingLimit;
if (lateMs) fake.queueSendResponses({ status: 200, delayMs: lateMs, acceptFirst: true });
if (failCode) {
  fake.queueSendResponses(...Array.from({ length: 1000 }, () => metaError(400, failCode)));
}
console.log(`fake Meta on ${await fake.start(port)}; token "${fake.validToken}"; WABA any; phone number "phone-1"`);
